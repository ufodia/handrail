/// <reference types="chrome" />
import {
  createId,
  isSafeSelector,
  MAX_STEPS,
  normalizePageUrl,
  validateSession,
  type ContentMessage,
  type ContentResponse,
  type GuideStep,
  type Session,
} from './core';

// A document may be injected again after a popup invocation or same-origin
// navigation. Its isolated-world listener is installed once, never in page JS.
const scope = globalThis as typeof globalThis & { __handrailContentInstalled?: boolean };
if (window === window.top && !scope.__handrailContentInstalled) {
  scope.__handrailContentInstalled = true;
  install();
}

function install(): void {
  let session: Session | null = null;
  let host: HTMLDivElement | null = null;
  let shadow: ShadowRoot | null = null;
  let target: Element | null = null;
  let observer: MutationObserver | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let pathTimer: ReturnType<typeof setInterval> | undefined;
  let busy = false;
  let pendingRecords = 0;
  let recordQueue: Promise<void> = Promise.resolve();
  let notice = '';

  const normalizedName = (value: string): string => value.replace(/\s+/g, ' ').trim();

  /**
   * ARIA references can point anywhere in the document, including form defaults
   * and explicitly private content. Check the complete region before reading any
   * of its text; one unsafe/missing reference rejects the whole control label.
   * Hidden decorative descendants are skipped separately by the text walker.
   */
  function safeTextRegion(element: Element): boolean {
    const privateRegion =
      'input,textarea,select,[contenteditable]:not([contenteditable="false"]),' +
      '[data-private],[data-sensitive],[data-handrail-private]';
    if (
      element.getRootNode() !== document ||
      element.closest(`${privateRegion},[hidden],[aria-hidden="true"],[inert]`) ||
      element.querySelector(privateRegion) ||
      element.closest('form')?.querySelector('input[type="password"]') ||
      !visible(element)
    )
      return false;
    return element.querySelectorAll('*').length <= 128;
  }

  /** Read only visible text nodes, never a hidden/decorative subtree's text. */
  function visibleLabelText(element: Element): string | null {
    if (!safeTextRegion(element)) return null;
    const pieces: string[] = [];
    let visited = 0;
    let characters = 0;
    let exceeded = false;
    function visit(node: Node): void {
      if (exceeded) return;
      if (++visited > 256) {
        exceeded = true;
        return;
      }
      if (node instanceof Element) {
        if (
          node.matches(
            '[hidden],[aria-hidden="true"],[inert],script,style,noscript,template,iframe,object,embed,video,audio,canvas',
          ) ||
          !visible(node)
        )
          return;
        for (const child of node.childNodes) visit(child);
      } else if (node.nodeType === Node.TEXT_NODE) {
        const text = node as Text;
        // Bound length using metadata before accessing the text's data.
        characters += text.length;
        if (characters > 320) {
          exceeded = true;
          return;
        }
        pieces.push(text.data);
      }
    }
    visit(element);
    return exceeded ? null : normalizedName(pieces.join(''));
  }

  function controlName(element: Element): string {
    const label = element.getAttribute('aria-label');
    if (label) return normalizedName(label);
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy?.trim()) {
      if (labelledBy.length > 256) return '';
      const ids = labelledBy.split(/\s+/).filter(Boolean);
      if (ids.length > 4) return '';
      const references = ids.map((id) => document.getElementById(id));
      if (references.some((reference) => !reference || !safeTextRegion(reference))) return '';
      // All references have passed privacy, visibility and size checks. Do not
      // fall back to the button's own text when an ARIA label is unsupported.
      const names = references.map((reference) => visibleLabelText(reference!));
      if (names.some((name) => name === null)) return '';
      return normalizedName(names.join(' '));
    }
    return visibleLabelText(element) ?? '';
  }

  function controlRole(element: Element): string {
    const explicit = element.getAttribute('role');
    if (explicit === 'button' || explicit === 'link') return explicit;
    return element.localName === 'a' ? 'link' : 'button';
  }

  function supported(element: Element): boolean {
    if (
      element.getRootNode() !== document ||
      element.closest(
        '[hidden],[aria-hidden="true"],[inert],[data-private],[data-sensitive],[data-handrail-private]',
      )
    )
      return false;
    if (!element.matches('button,a[href],summary,[role="button"],[role="link"]')) return false;
    if (element.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"])'))
      return false;
    if (
      element.querySelector(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[data-private],[data-sensitive],[data-handrail-private]',
      )
    )
      return false;
    if (element.closest('form')?.querySelector('input[type="password"]')) return false;
    if (element.matches(':disabled,[aria-disabled="true"]')) return false;
    return true;
  }

  function visible(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || element.getClientRects().length === 0) return false;
    for (let current: Element | null = element; current; current = current.parentElement) {
      const style = getComputedStyle(current);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse' ||
        style.contentVisibility === 'hidden' ||
        Number(style.opacity) === 0
      )
        return false;
    }
    return true;
  }

  function unique(selector: string, element: Element): boolean {
    if (!isSafeSelector(selector)) return false;
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  }

  function attributeSelector(attribute: string, value: string): string {
    return `[${attribute}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
  }

  function selectorFor(element: Element): string | null {
    if (element.id && element.id.length <= 160) {
      const selector = `#${CSS.escape(element.id)}`;
      if (unique(selector, element)) return selector;
    }
    for (const attribute of ['data-testid', 'data-test', 'data-qa']) {
      const value = element.getAttribute(attribute);
      if (value && value.length <= 160) {
        const selector = attributeSelector(attribute, value);
        if (unique(selector, element)) return selector;
      }
    }
    const segments: string[] = [];
    for (
      let current: Element | null = element;
      current && current !== document.documentElement && segments.length < 11;
      current = current.parentElement
    ) {
      if (current === document.body) {
        segments.unshift('body');
        break;
      }
      if (!/^[a-z][a-z0-9-]{0,31}$/.test(current.localName)) return null;
      let index = 1;
      for (
        let sibling = current.previousElementSibling;
        sibling;
        sibling = sibling.previousElementSibling
      )
        if (sibling.localName === current.localName) index++;
      segments.unshift(`${current.localName}:nth-of-type(${index})`);
      const candidate = segments.join(' > ');
      if (unique(candidate, element)) return candidate;
    }
    const selector = segments.join(' > ');
    return unique(selector, element) ? selector : null;
  }

  function targetFor(step: GuideStep): { element?: Element; reason?: string } {
    const page = normalizePageUrl(location.href);
    if (!session || page.origin !== session.origin || page.pathname !== step.pathname)
      return {
        reason: 'This page path does not match the current step. Open its saved page and resume.',
      };
    let matches: NodeListOf<Element>;
    try {
      matches = document.querySelectorAll(step.selector);
    } catch {
      return { reason: 'The saved selector is no longer usable. Record this control again.' };
    }
    if (matches.length !== 1)
      return {
        reason: matches.length
          ? 'The saved target is ambiguous. Record a unique control again.'
          : 'The next control is missing. Open the expected page state, then resume.',
      };
    const element = matches[0]!;
    if (!supported(element) || !visible(element))
      return {
        reason:
          'The next control is hidden, disabled or unsupported. Make it available, then resume.',
      };
    if (
      element.localName !== step.tag ||
      controlRole(element) !== step.role ||
      controlName(element) !== step.name
    )
      return {
        reason:
          'The saved control changed its identity or label. Review this guide and record the step again.',
      };
    return { element };
  }

  function stopObserving(): void {
    observer?.disconnect();
    observer = null;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    if (pathTimer !== undefined) clearInterval(pathTimer);
    refreshTimer = undefined;
    pathTimer = undefined;
  }

  function destroy(): void {
    stopObserving();
    host?.remove();
    host = null;
    shadow = null;
    target = null;
    session = null;
    notice = '';
    busy = false;
  }

  function ensureOverlay(): void {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.id = 'handrail-overlay';
    host.style.cssText =
      'all:initial;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `:host{color-scheme:light}*{box-sizing:border-box}.highlight{position:fixed;border:3px solid #c27a43;border-radius:7px;pointer-events:none;box-shadow:0 0 0 4px #fff8;display:none}.panel{position:fixed;right:20px;bottom:20px;width:340px;max-width:calc(100vw - 40px);padding:20px;background:#f8f6f0;color:#233d52;border:1px solid #aab9bf;border-radius:13px;box-shadow:0 12px 40px #10263630;font:14px/1.5 system-ui,sans-serif;pointer-events:auto}.brand{font:11px monospace;letter-spacing:.12em;color:#506d7d;margin:0 0 9px}.title{font-size:19px;line-height:1.3;margin:0 0 9px}.instruction{margin:0 0 10px;font-size:15px;overflow-wrap:anywhere}.message{margin:0 0 12px;font-size:12px;color:#526978;overflow-wrap:anywhere}.actions{display:flex;gap:8px;flex-wrap:wrap}button{font:inherit;border:1px solid #768e9b;border-radius:5px;padding:7px 10px;background:white;color:#233d52;cursor:pointer}button:focus-visible{outline:3px solid #c27a43;outline-offset:2px}button:disabled{opacity:.5;cursor:default}.primary{background:#233d52;color:white}.foot{font-size:11px;color:#617986;margin:12px 0 0}`;
    shadow.append(style);
    const highlight = document.createElement('div');
    highlight.className = 'highlight';
    highlight.setAttribute('aria-hidden', 'true');
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Handrail guide');
    for (const [tag, className] of [
      ['p', 'brand'],
      ['h2', 'title'],
      ['p', 'instruction'],
      ['p', 'message'],
      ['div', 'actions'],
      ['p', 'foot'],
    ] as const) {
      const item = document.createElement(tag);
      item.className = className;
      if (className === 'message') {
        item.setAttribute('role', 'status');
        item.setAttribute('aria-live', 'polite');
      }
      panel.append(item);
    }
    shadow.append(highlight, panel);
    document.documentElement.append(host);
  }

  function button(label: string, action: () => void, primary = false): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = label;
    if (primary) item.className = 'primary';
    item.disabled = busy || pendingRecords > 0;
    item.addEventListener('click', (event) => {
      if (event.isTrusted && !item.disabled) action();
    });
    return item;
  }

  function render(): void {
    if (!session) return;
    ensureOverlay();
    const get = <T extends HTMLElement>(selector: string): T => shadow!.querySelector<T>(selector)!;
    get('.brand').textContent =
      `HANDRAIL / ${session.mode === 'record' ? 'RECORDING' : session.status === 'complete' ? 'COMPLETE' : 'YOUR NEXT STEP'}`;
    get('.title').textContent = session.guide.name;
    const step = session.guide.steps[session.stepIndex];
    get('.instruction').textContent =
      session.mode === 'record'
        ? `${session.guide.steps.length} / ${MAX_STEPS} steps captured. Make the clicks you want to explain.`
        : session.status === 'complete'
          ? 'You completed every step yourself.'
          : `${session.stepIndex + 1} / ${session.guide.steps.length} · ${step?.instruction ?? 'Review this guide in the popup.'}`;
    get('.message').textContent =
      notice ||
      session.reason ||
      (session.mode === 'record'
        ? 'Ordinary buttons and links only. Text inputs and private controls are ignored.'
        : `Look for “${step?.name ?? 'the next control'}”.`);
    get('.foot').textContent = 'Your clicks do the work. No automatic clicks or form filling.';
    const actions = get('.actions');
    actions.replaceChildren();
    if (session.status === 'active') {
      if (session.mode === 'replay' && target)
        actions.append(
          button('Show target', () =>
            target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' }),
          ),
        );
      actions.append(
        button(
          'Pause',
          () =>
            void command({
              type: 'PAUSE_SESSION',
              reason: 'Paused by you. Resume when the page is ready.',
            }),
        ),
      );
    } else if (session.status === 'paused')
      actions.append(button('Resume', () => void command({ type: 'RESUME_SESSION' }), true));
    if (session.mode === 'record') {
      const save = button(
        'Save recording',
        () => void command({ type: 'STOP_SESSION', save: true }),
        true,
      );
      save.disabled ||= session.guide.steps.length === 0;
      actions.append(
        save,
        button('Discard recording', () => void command({ type: 'STOP_SESSION', save: false })),
      );
    } else
      actions.append(
        button('Stop guide', () => void command({ type: 'STOP_SESSION', save: false })),
      );
    const highlight = get<HTMLDivElement>('.highlight');
    if (target && session.status === 'active' && session.mode === 'replay') {
      const rect = target.getBoundingClientRect();
      highlight.style.cssText = `display:block;left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px`;
    } else highlight.style.display = 'none';
  }

  async function command(
    fields: Omit<ContentMessage, 'source' | 'token' | 'stepIndex'> & { stepIndex?: number },
  ): Promise<void> {
    if (!session || busy) return;
    const token = session.token;
    busy = true;
    render();
    try {
      const response = (await chrome.runtime.sendMessage({
        source: 'content',
        token,
        stepIndex: session.stepIndex,
        ...fields,
      })) as ContentResponse;
      if (!session || session.token !== token) return;
      if (!response.ok) {
        notice = response.error;
        session = { ...session, status: 'paused' };
      } else if (response.session) {
        session = validateSession(response.session);
        notice = '';
      } else {
        destroy();
        return;
      }
    } catch {
      if (session?.token === token) {
        session = { ...session, status: 'paused' };
        notice = 'The extension connection ended. Open Handrail from the toolbar to resume.';
      }
    } finally {
      busy = false;
      if (session) {
        observe();
        refresh();
      }
    }
  }

  function refresh(): void {
    if (!session) return;
    target = null;
    if (session.status === 'active' && session.mode === 'replay' && !busy) {
      const step = session.guide.steps[session.stepIndex];
      if (!step) {
        void command({
          type: 'PAUSE_SESSION',
          reason: 'This guide has no current step. Review it in the popup.',
        });
        return;
      }
      const resolved = targetFor(step);
      if (!resolved.element) {
        void command({ type: 'PAUSE_SESSION', reason: resolved.reason });
        return;
      }
      target = resolved.element;
    }
    render();
  }

  function schedule(): void {
    if (
      !session ||
      session.status !== 'active' ||
      session.mode !== 'replay' ||
      refreshTimer !== undefined
    )
      return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refresh();
    }, 100);
  }

  function observe(): void {
    stopObserving();
    if (session?.status !== 'active' || session.mode !== 'replay') return;
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    pathTimer = setInterval(schedule, 500);
  }

  function record(step: GuideStep, token: string): void {
    if (pendingRecords >= 8) {
      notice =
        'Several clicks are still being saved. Wait for the captured count before continuing.';
      render();
      return;
    }
    pendingRecords++;
    render();
    recordQueue = recordQueue
      .then(async () => {
        if (
          !session ||
          session.token !== token ||
          session.mode !== 'record' ||
          session.status !== 'active'
        )
          return;
        const response = (await chrome.runtime.sendMessage({
          source: 'content',
          type: 'RECORD_STEP',
          token,
          step,
          expectedCount: session.guide.steps.length,
        })) as ContentResponse;
        if (!session || session.token !== token) return;
        if (!response.ok) {
          notice = response.error;
          session = { ...session, status: 'paused' };
        } else if (response.session) {
          session = validateSession(response.session);
          notice = '';
        }
      })
      .catch(() => {
        if (session?.token === token) {
          session = { ...session, status: 'paused' };
          notice = 'This click could not be saved. Open the popup and review the captured steps.';
        }
      })
      .finally(() => {
        pendingRecords--;
        if (session) render();
      });
  }

  function onClick(event: MouseEvent): void {
    if (
      !event.isTrusted ||
      !session ||
      session.status !== 'active' ||
      event.composedPath().includes(host!)
    )
      return;
    const clicked = event.composedPath().find((node) => node instanceof Element) as
      Element | undefined;
    const element = clicked?.closest('button,a[href],summary,[role="button"],[role="link"]');
    if (!element || !supported(element) || !visible(element)) return;
    if (session.mode === 'replay') {
      if (busy) return;
      const step = session.guide.steps[session.stepIndex];
      if (!step || targetFor(step).element !== element) return;
      void command({ type: 'REPLAY_CLICK', stepId: step.id });
      return;
    }
    const name = controlName(element);
    const selector = selectorFor(element);
    if (!name || name.length > 80 || !selector) {
      notice = 'This control has no short, unique label and selector. Choose another control.';
      render();
      return;
    }
    const page = normalizePageUrl(location.href);
    record(
      {
        id: createId(),
        pathname: page.pathname,
        selector,
        tag: element.localName,
        role: controlRole(element),
        name,
        instruction: `Choose ${name}`.slice(0, 240),
      },
      session.token,
    );
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !message || typeof message !== 'object')
      return false;
    const payload = message as {
      source?: string;
      type?: string;
      session?: unknown;
      token?: string;
    };
    if (payload.source !== 'background') return false;
    try {
      if (payload.type === 'STOP_SESSION' && session && payload.token === session.token) {
        destroy();
        sendResponse({ ok: true });
        return false;
      }
      if (payload.type !== 'APPLY_SESSION') return false;
      const incoming = validateSession(payload.session);
      if (normalizePageUrl(location.href).origin !== incoming.origin) {
        sendResponse({ ok: false });
        return false;
      }
      session = incoming;
      target = null;
      notice = '';
      busy = false;
      observe();
      refresh();
      sendResponse({ ok: true });
    } catch {
      sendResponse({ ok: false });
    }
    return false;
  });
  window.addEventListener('click', onClick, true);
  window.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('popstate', schedule);
  window.addEventListener('hashchange', schedule);
  window.addEventListener('pagehide', destroy);
}
