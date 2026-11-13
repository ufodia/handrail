export interface GuideStep {
  id: string;
  pathname: string;
  selector: string;
  tag: string;
  role: string;
  name: string;
  instruction: string;
}
export interface Guide {
  version: 1;
  id: string;
  name: string;
  description: string;
  origin: string;
  steps: GuideStep[];
}
export interface Session {
  version: 1;
  tabId: number;
  token: string;
  mode: 'record' | 'replay';
  status: 'active' | 'paused' | 'complete';
  origin: string;
  guide: Guide;
  stepIndex: number;
  reason: string;
  documentId?: string;
}
export interface PopupState {
  guides: Guide[];
  session: Session | null;
  activeTab: { id?: number; url?: string; eligible: boolean; reason: string };
}
export type PopupResponse = { ok: true; state: PopupState } | { ok: false; error: string };
export type PopupMessage = {
  source: 'popup';
  type:
    | 'GET_STATE'
    | 'START_RECORD'
    | 'START_REPLAY'
    | 'PAUSE'
    | 'RESUME'
    | 'STOP'
    | 'SAVE_GUIDE'
    | 'DELETE_GUIDE';
  name?: string;
  description?: string;
  guideId?: string;
  guide?: unknown;
  save?: boolean;
};
export interface ContentMessage {
  source: 'content';
  type: 'RECORD_STEP' | 'REPLAY_CLICK' | 'PAUSE_SESSION' | 'RESUME_SESSION' | 'STOP_SESSION';
  token: string;
  expectedCount?: number;
  step?: unknown;
  stepIndex?: number;
  stepId?: string;
  reason?: string;
  save?: boolean;
}
export type ContentResponse = { ok: true; session: Session | null } | { ok: false; error: string };
export interface SenderLike {
  id?: string;
  url?: string;
  tab?: { id?: number; url?: string };
  frameId?: number;
  documentId?: string;
  documentLifecycle?: string;
}

export const MAX_GUIDES = 20;
export const MAX_STEPS = 40;
export const MAX_JSON_BYTES = 256 * 1024;
const ID = /^[a-zA-Z0-9_-]{1,48}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    throw new Error(`${label} must contain ${allowEmpty ? '0' : '1'}–${max} readable characters.`);
  return value.trim();
}
const id = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !ID.test(value))
    throw new Error(`${label} must contain 1–48 letters, numbers, dashes or underscores.`);
  return value;
};

/** Queries, fragments and credentials are never part of stored page identity. */
export function normalizePageUrl(value: string): { origin: string; pathname: string; url: string } {
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('Use a regular HTTP or HTTPS page.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Use a regular HTTP or HTTPS page.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin.length > 512 ||
    url.pathname.length > 1024
  )
    throw new Error('Use an HTTP(S) page without embedded credentials and with a short page path.');
  return { origin: url.origin, pathname: url.pathname, url: url.origin + url.pathname };
}

function validateOrigin(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A guide needs one exact HTTP(S) origin.');
  const page = normalizePageUrl(value);
  const parsed = new URL(value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || value !== page.origin)
    throw new Error('Guide origin must be canonical and contain no path, query or fragment.');
  return page.origin;
}

/**
 * Restricted selector grammar: escaped ids, selected test-id attributes, and
 * direct-child nth-of-type paths. No URL/value attributes or broad DOM scans.
 */
export function isSafeSelector(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f]/.test(value))
    return false;
  const segments = value.split(' > ');
  if (segments.length > 12 || segments.some((segment) => !segment)) return false;
  const escapedId = /^#(?:\\(?:[0-9a-fA-F]{1,6} ?|[^\n\r\f])|[a-zA-Z0-9_\-\u0080-\uffff])+$/;
  const testId =
    /^\[(?:data-testid|data-test|data-qa)="(?:\\(?:[0-9a-fA-F]{1,6} ?|[^\n\r\f])|[^"\\\n\r\f]){1,160}"\]$/;
  const structural = /^[a-z][a-z0-9-]{0,31}:nth-of-type\([1-9][0-9]{0,3}\)$/;
  return segments.every(
    (segment, index) =>
      escapedId.test(segment) ||
      testId.test(segment) ||
      structural.test(segment) ||
      (segment === 'body' && index === 0 && segments.length > 1),
  );
}

export function validateStep(value: unknown): GuideStep {
  if (!object(value)) throw new Error('Every guide step must be an object.');
  const pathname = text(value.pathname, 'Page path', 1024);
  if (
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname.includes('?') ||
    pathname.includes('#') ||
    pathname.includes('\\') ||
    /[\r\n\t]/.test(pathname)
  )
    throw new Error('Step paths must be exact paths without queries or fragments.');
  if (!isSafeSelector(value.selector))
    throw new Error('Step selector is not a bounded Handrail selector. Record this control again.');
  const tag = text(value.tag, 'Target tag', 32);
  const role = text(value.role, 'Target role', 32);
  if (
    !/^[a-z][a-z0-9-]{0,31}$/.test(tag) ||
    !['button', 'link'].includes(role) ||
    ['input', 'textarea', 'select', 'option', 'iframe', 'script', 'html', 'body'].includes(tag)
  )
    throw new Error('Only ordinary clickable controls can be guide targets.');
  return {
    id: id(value.id, 'Step id'),
    pathname,
    selector: value.selector,
    tag,
    role,
    name: text(value.name, 'Target name', 80),
    instruction: text(value.instruction, 'Step instruction', 240),
  };
}

/** The recording draft may be empty; saved/imported guides may not. */
export function validateGuide(value: unknown, allowEmpty = false): Guide {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Array.isArray(value.steps) ||
    value.steps.length > MAX_STEPS ||
    (!allowEmpty && value.steps.length < 1)
  )
    throw new Error('A saved guide needs 1–40 steps and version 1.');
  const steps = value.steps.map(validateStep);
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    throw new Error('Step ids must be unique within a guide.');
  return {
    version: 1,
    id: id(value.id, 'Guide id'),
    name: text(value.name, 'Guide name', 80),
    description: text(value.description, 'Guide description', 400, true),
    origin: validateOrigin(value.origin),
    steps,
  };
}

export function validateGuides(value: unknown): Guide[] {
  if (!Array.isArray(value) || value.length > MAX_GUIDES)
    throw new Error('Keep at most 20 saved guides.');
  const guides = value.map((guide) => validateGuide(guide));
  if (new Set(guides.map((guide) => guide.id)).size !== guides.length)
    throw new Error('Saved guide ids must be unique.');
  return guides;
}

export function parseGuideJson(source: string): Guide {
  if (typeof source !== 'string' || new TextEncoder().encode(source).byteLength > MAX_JSON_BYTES)
    throw new Error('Guide JSON must be no larger than 256 KiB.');
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error('This file is not valid guide JSON.');
  }
  return validateGuide(value);
}

export function createId(): string {
  return crypto.randomUUID();
}

export function validateSession(value: unknown): Session {
  if (
    !object(value) ||
    value.version !== 1 ||
    !Number.isInteger(value.tabId) ||
    (value.tabId as number) < 0 ||
    !['record', 'replay'].includes(value.mode as string) ||
    !['active', 'paused', 'complete'].includes(value.status as string)
  )
    throw new Error('The saved session is invalid.');
  const guide = validateGuide(value.guide, value.mode === 'record');
  const origin = validateOrigin(value.origin);
  if (
    origin !== guide.origin ||
    !Number.isInteger(value.stepIndex) ||
    (value.stepIndex as number) < 0 ||
    (value.stepIndex as number) > guide.steps.length
  )
    throw new Error('The session does not match its guide.');
  if (value.mode === 'record' && value.stepIndex !== guide.steps.length)
    throw new Error('Recording progress must match its captured steps.');
  if (value.mode === 'record' && value.status === 'complete')
    throw new Error('Recordings must be saved or cancelled, not marked as completed replays.');
  if (
    value.mode === 'replay' &&
    value.status === 'active' &&
    value.stepIndex === guide.steps.length
  )
    throw new Error('A completed replay cannot remain active.');
  const session: Session = {
    version: 1,
    tabId: value.tabId as number,
    token: id(value.token, 'Session token'),
    mode: value.mode as Session['mode'],
    status: value.status as Session['status'],
    origin,
    guide,
    stepIndex: value.stepIndex as number,
    reason: text(value.reason, 'Session message', 240, true),
  };
  if (value.documentId !== undefined)
    session.documentId = text(value.documentId, 'Document id', 80);
  return session;
}

export function isPopupSender(sender: SenderLike, runtimeId: string): boolean {
  return sender.id === runtimeId && sender.url === `chrome-extension://${runtimeId}/popup.html`;
}

/** A click may have just navigated; its bound source document/path remains exact. */
export function isContentSender(
  sender: SenderLike,
  session: Session,
  currentUrl: string,
  runtimeId: string,
): boolean {
  if (
    sender.id !== runtimeId ||
    sender.tab?.id !== session.tabId ||
    sender.frameId !== 0 ||
    !session.documentId ||
    sender.documentId !== session.documentId ||
    (sender.documentLifecycle && sender.documentLifecycle !== 'active')
  )
    return false;
  try {
    const source = normalizePageUrl(sender.url ?? '');
    const current = normalizePageUrl(currentUrl);
    if (source.origin !== session.origin || current.origin !== session.origin) return false;
    if (
      session.mode === 'replay' &&
      session.status !== 'complete' &&
      source.pathname !== session.guide.steps[session.stepIndex]?.pathname
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

export function appendRecordedStep(
  input: Session,
  rawStep: unknown,
  expectedCount: number,
): Session {
  const session = validateSession(input);
  if (
    session.mode !== 'record' ||
    session.status !== 'active' ||
    expectedCount !== session.guide.steps.length ||
    session.guide.steps.length >= MAX_STEPS
  )
    throw new Error(
      'Recording state changed. Resume from the popup before capturing another step.',
    );
  const step = validateStep(rawStep);
  if (session.guide.steps.some((existing) => existing.id === step.id))
    throw new Error('This step was already recorded.');
  session.guide.steps.push(step);
  session.stepIndex = session.guide.steps.length;
  session.reason = `${session.guide.steps.length} step${session.guide.steps.length === 1 ? '' : 's'} captured.`;
  return session;
}

export function advanceReplay(input: Session, stepIndex: number, stepId: string): Session {
  const session = validateSession(input);
  if (
    session.mode !== 'replay' ||
    session.status !== 'active' ||
    session.stepIndex !== stepIndex ||
    session.guide.steps[stepIndex]?.id !== stepId
  )
    throw new Error('Replay state changed. Resume from the popup.');
  session.stepIndex++;
  if (session.stepIndex === session.guide.steps.length) {
    session.status = 'complete';
    session.reason = 'Guide complete. Every step was advanced by your click.';
  } else session.reason = '';
  return session;
}
