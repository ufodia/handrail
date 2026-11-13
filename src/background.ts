/// <reference types="chrome" />
import {
  advanceReplay,
  appendRecordedStep,
  createId,
  isContentSender,
  isPopupSender,
  MAX_GUIDES,
  MAX_JSON_BYTES,
  normalizePageUrl,
  validateGuide,
  validateGuides,
  validateSession,
  validateStep,
  type ContentMessage,
  type Guide,
  type PopupMessage,
  type PopupState,
  type Session,
} from './core';

const GUIDES_KEY = 'handrail-guides-v1';
const SESSION_KEY = 'handrail-session-v1';
let queue: Promise<unknown> = Promise.resolve();

/** MV3 events may interleave. Every read-modify-write uses one ordered queue. */
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

async function loadGuides(): Promise<Guide[]> {
  const stored = await chrome.storage.local.get(GUIDES_KEY);
  return validateGuides(stored[GUIDES_KEY] ?? []);
}
async function loadSession(): Promise<Session | null> {
  const stored = await chrome.storage.session.get(SESSION_KEY);
  return stored[SESSION_KEY] ? validateSession(stored[SESSION_KEY]) : null;
}
async function storeSession(session: Session | null): Promise<void> {
  if (session) await chrome.storage.session.set({ [SESSION_KEY]: validateSession(session) });
  else await chrome.storage.session.remove(SESSION_KEY);
}

async function popupState(): Promise<PopupState> {
  const [guides, session, tabs] = await Promise.all([
    loadGuides(),
    loadSession(),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  const tab = tabs[0];
  let activeTab: PopupState['activeTab'] = {
    eligible: false,
    reason: 'Open Handrail from its toolbar action on an HTTP(S) page.',
  };
  if (tab?.id !== undefined) {
    try {
      const page = normalizePageUrl(tab.url ?? '');
      activeTab = { id: tab.id, url: page.url, eligible: true, reason: '' };
    } catch {
      activeTab = {
        id: tab.id,
        eligible: false,
        reason:
          'Use a regular HTTP(S) page. Chrome pages, extension pages and embedded credentials are unsupported.',
      };
    }
  }
  return { guides, session, activeTab };
}

async function targetTab(): Promise<{ tabId: number; origin: string; pathname: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined)
    throw new Error('Choose a page tab and open Handrail from the toolbar.');
  const page = normalizePageUrl(tab.url ?? '');
  return { tabId: tab.id, origin: page.origin, pathname: page.pathname };
}

async function sendSession(session: Session): Promise<void> {
  if (!session.documentId) return;
  await chrome.tabs.sendMessage(
    session.tabId,
    { source: 'background', type: 'APPLY_SESSION', session },
    { documentId: session.documentId },
  );
}

async function pause(session: Session, reason: string): Promise<Session> {
  const paused: Session = { ...session, status: 'paused', reason: reason.slice(0, 240) };
  await storeSession(paused);
  await sendSession(paused).catch(() => undefined);
  return paused;
}

async function activate(session: Session): Promise<Session> {
  try {
    const tab = await chrome.tabs.get(session.tabId);
    const page = normalizePageUrl(tab.url ?? '');
    if (page.origin !== session.origin)
      return pause(
        session,
        'This tab changed origin. Return to the guide site, open Handrail there, and choose Resume.',
      );
    if (
      session.mode === 'replay' &&
      session.guide.steps[session.stepIndex]?.pathname !== page.pathname
    )
      return pause(
        session,
        'This page path does not match the current guide step. Navigate to its saved path and choose Resume.',
      );
    const injected = await chrome.scripting.executeScript({
      target: { tabId: session.tabId, frameIds: [0] },
      files: ['content.js'],
    });
    const documentId = injected.find((frame) => frame.frameId === 0)?.documentId;
    if (!documentId) throw new Error('A bound document is unavailable.');
    const current = normalizePageUrl((await chrome.tabs.get(session.tabId)).url ?? '');
    if (current.url !== page.url)
      return pause(
        session,
        'The page changed while Handrail was starting. Review the page and choose Resume.',
      );
    const active: Session = {
      ...session,
      status: 'active',
      token: createId(),
      documentId,
      reason:
        session.mode === 'record'
          ? `${session.guide.steps.length} steps captured. Click ordinary page controls to add steps.`
          : '',
    };
    await storeSession(active);
    await sendSession(active);
    return active;
  } catch {
    return pause(
      session,
      'Chrome could not grant page access. Open Handrail from its toolbar action on the target tab, then choose Resume.',
    );
  }
}

async function saveGuide(guide: Guide): Promise<void> {
  const guides = await loadGuides();
  const existing = guides.findIndex((item) => item.id === guide.id);
  if (existing < 0 && guides.length >= MAX_GUIDES)
    throw new Error(
      'Twenty guides are already saved. Delete an unneeded guide before saving another.',
    );
  if (existing < 0) guides.push(validateGuide(guide));
  else guides[existing] = validateGuide(guide);
  await chrome.storage.local.set({ [GUIDES_KEY]: validateGuides(guides) });
}

async function stopSession(session: Session, save: boolean): Promise<void> {
  if (session.mode === 'record' && save) await saveGuide(validateGuide(session.guide));
  if (session.documentId)
    await chrome.tabs
      .sendMessage(
        session.tabId,
        { source: 'background', type: 'STOP_SESSION', token: session.token },
        { documentId: session.documentId },
      )
      .catch(() => undefined);
  await storeSession(null);
}

async function handlePopup(message: PopupMessage): Promise<{ ok: true; state: PopupState }> {
  let session = await loadSession();
  if (message.type === 'GET_STATE') return { ok: true, state: await popupState() };
  if (message.type === 'START_RECORD' || message.type === 'START_REPLAY') {
    if (session && session.status !== 'complete')
      throw new Error('Save or stop the current session before starting another.');
    if (session) await stopSession(session, false);
    const tab = await targetTab();
    let guide: Guide;
    if (message.type === 'START_RECORD')
      guide = validateGuide(
        {
          version: 1,
          id: createId(),
          name: message.name,
          description: message.description ?? '',
          origin: tab.origin,
          steps: [],
        },
        true,
      );
    else {
      const saved = (await loadGuides()).find((item) => item.id === message.guideId);
      if (!saved) throw new Error('That saved guide was not found.');
      guide = validateGuide(saved);
      if (guide.origin !== tab.origin)
        throw new Error('Open this guide’s exact site origin before starting it.');
    }
    session = {
      version: 1,
      tabId: tab.tabId,
      token: createId(),
      mode: message.type === 'START_RECORD' ? 'record' : 'replay',
      status: 'paused',
      origin: guide.origin,
      guide,
      stepIndex: 0,
      reason: '',
    };
    await storeSession(session);
    await activate(session);
  } else if (message.type === 'SAVE_GUIDE') {
    let json: string;
    try {
      json = JSON.stringify(message.guide);
    } catch {
      throw new Error('The guide cannot be serialized.');
    }
    if (!json || new TextEncoder().encode(json).byteLength > MAX_JSON_BYTES)
      throw new Error('Guide JSON must be no larger than 256 KiB.');
    const guide = validateGuide(message.guide);
    if (session?.guide.id === guide.id)
      throw new Error('Stop this guide’s session before editing its saved copy.');
    await saveGuide(guide);
  } else if (message.type === 'DELETE_GUIDE') {
    if (session?.guide.id === message.guideId)
      throw new Error('Stop this guide’s session before deleting it.');
    const guides = await loadGuides();
    if (!guides.some((guide) => guide.id === message.guideId))
      throw new Error('That guide was not found.');
    await chrome.storage.local.set({
      [GUIDES_KEY]: guides.filter((guide) => guide.id !== message.guideId),
    });
  } else {
    if (!session) throw new Error('There is no current session.');
    if (message.type === 'PAUSE') {
      if (session.status === 'complete') throw new Error('This guide is already complete.');
      await pause(session, 'Paused by you. Resume when the page and target are ready.');
    } else if (message.type === 'RESUME') {
      if (session.status === 'complete')
        throw new Error('Stop the completed guide and start it again to replay.');
      const tab = await targetTab();
      if (tab.tabId !== session.tabId)
        throw new Error('Return to the session’s original tab before resuming.');
      await activate(session);
    } else if (message.type === 'STOP') {
      if (typeof message.save !== 'boolean')
        throw new Error('Choose whether to save or discard this recording.');
      await stopSession(session, message.save);
    } else throw new Error('This popup command is not supported.');
  }
  return { ok: true, state: await popupState() };
}

async function handleContent(
  message: ContentMessage,
  sender: chrome.runtime.MessageSender,
): Promise<{ ok: true; session: Session | null }> {
  const session = await loadSession();
  if (!session) throw new Error('There is no current Handrail session.');
  const tab = await chrome.tabs.get(session.tabId);
  if (
    message.token !== session.token ||
    !isContentSender(sender, session, tab.url ?? '', chrome.runtime.id)
  )
    throw new Error('This page is no longer the bound session document.');
  const source = normalizePageUrl(sender.url ?? '');
  const current = normalizePageUrl(tab.url ?? '');
  const navigationClick = message.type === 'RECORD_STEP' || message.type === 'REPLAY_CLICK';
  if (!navigationClick && current.pathname !== source.pathname)
    throw new Error('The page changed. Resume from the popup.');
  let next: Session | null = session;
  if (message.type === 'RECORD_STEP') {
    const step = validateStep(message.step);
    if (step.pathname !== source.pathname)
      throw new Error('The captured step does not match its source page.');
    next = appendRecordedStep(session, step, message.expectedCount as number);
    await storeSession(next);
  } else if (message.type === 'REPLAY_CLICK') {
    next = advanceReplay(session, message.stepIndex as number, message.stepId ?? '');
    await storeSession(next);
  } else {
    if (message.stepIndex !== session.stepIndex)
      throw new Error('This page has an outdated guide step.');
    if (message.type === 'PAUSE_SESSION') {
      if (session.status === 'complete') throw new Error('This guide is already complete.');
      next = await pause(
        session,
        typeof message.reason === 'string'
          ? message.reason
          : 'Paused. Review the page before resuming.',
      );
    } else if (message.type === 'RESUME_SESSION') {
      if (session.status !== 'paused') throw new Error('This session is not paused.');
      next = await activate(session);
    } else if (message.type === 'STOP_SESSION') {
      if (typeof message.save !== 'boolean') throw new Error('The stop command is incomplete.');
      await stopSession(session, message.save);
      next = null;
    } else throw new Error('This content command is not supported.');
  }
  return { ok: true, session: next };
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!message || typeof message !== 'object') {
    sendResponse({ ok: false, error: 'A valid extension message is required.' });
    return false;
  }
  const candidate = message as { source?: string };
  const popup = candidate.source === 'popup' && isPopupSender(sender, chrome.runtime.id);
  const content =
    candidate.source === 'content' &&
    sender.id === chrome.runtime.id &&
    sender.tab?.id !== undefined &&
    sender.frameId === 0;
  if (!popup && !content) {
    sendResponse({ ok: false, error: 'This sender is not authorized.' });
    return false;
  }
  void serialized<unknown>(() =>
    popup ? handlePopup(message as PopupMessage) : handleContent(message as ContentMessage, sender),
  ).then(sendResponse, (error) =>
    sendResponse({
      ok: false,
      error:
        error instanceof Error
          ? error.message.slice(0, 240)
          : 'The extension operation could not finish.',
    }),
  );
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (!change.url && change.status !== 'complete') return;
  void serialized(async () => {
    const session = await loadSession();
    if (!session || session.tabId !== tabId || session.status !== 'active') return;
    let page;
    try {
      page = normalizePageUrl(change.url ?? tab.url ?? '');
    } catch {
      await pause(session, 'This tab left its supported HTTP(S) page.');
      return;
    }
    if (page.origin !== session.origin) {
      await pause(
        session,
        'The site origin changed. Return to the guide site and open Handrail to resume.',
      );
      return;
    }
    if (change.status === 'complete') await activate(session);
  }).catch(() => undefined);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void serialized(async () => {
    const session = await loadSession();
    if (session?.tabId === tabId)
      await storeSession({
        ...session,
        status: 'paused',
        reason:
          session.mode === 'record'
            ? 'The recording tab closed. Save the captured steps or discard this draft from the popup.'
            : 'The guide tab closed. Stop this session, then open the guide on a new tab.',
      });
  }).catch(() => undefined);
});

// Content scripts receive only their current session through explicit messages.
void chrome.storage.local
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => undefined);
void chrome.storage.session
  .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  .catch(() => undefined);
