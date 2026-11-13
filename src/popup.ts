import {
  MAX_GUIDES,
  MAX_JSON_BYTES,
  parseGuideJson,
  validateGuide,
  type Guide,
  type PopupMessage,
  type PopupResponse,
  type PopupState,
} from './core';

const root = document.querySelector<HTMLDivElement>('#popup-app');
if (!root) throw new Error('Handrail popup root is missing.');
let state: PopupState | null = null;
let selectedId = '';
let draft: Guide | null = null;
let editing = false;
let busy = false;
let message = '';
let isError = false;
let discardId = '';
let newName = '';
let newDescription = '';
let lastState = '';
let stopped = false;

type Child = Node | string | null | false;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children)
    if (child !== null && child !== false)
      node.append(child instanceof Node ? child : document.createTextNode(child));
  return node;
}
function link(text: string, href: string, className = ''): HTMLAnchorElement {
  const node = el('a', className, text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener noreferrer';
  return node;
}
function button(
  text: string,
  action: () => void | Promise<void>,
  options: {
    primary?: boolean;
    danger?: boolean;
    disabled?: boolean;
    title?: string;
    testid?: string;
  } = {},
): HTMLButtonElement {
  const node = el(
    'button',
    `${options.primary ? 'primary' : 'secondary'}${options.danger ? ' danger' : ''}`,
    text,
  );
  node.type = 'button';
  node.disabled = busy || !!options.disabled;
  if (options.title) node.title = options.title;
  if (options.testid) node.dataset.testid = options.testid;
  node.addEventListener('click', () => {
    void action();
  });
  return node;
}
function field(
  label: string,
  value: string,
  maxLength: number,
  change: (value: string) => void,
  multiline = false,
): HTMLElement {
  const wrapper = el('label', 'field', el('span', '', label));
  const input = document.createElement(multiline ? 'textarea' : 'input');
  input.value = value;
  input.maxLength = maxLength;
  input.disabled = busy;
  input.addEventListener('input', () => change(input.value));
  if (input instanceof HTMLTextAreaElement) input.rows = 3;
  wrapper.append(input);
  return wrapper;
}
function notice(text: string, error = false): void {
  message = text;
  isError = error;
}
function activeGuide(): Guide | undefined {
  return state?.guides.find((guide) => guide.id === selectedId);
}
function copyGuide(guide: Guide): Guide {
  return { ...guide, steps: guide.steps.map((step) => ({ ...step })) };
}

async function request(message: PopupMessage): Promise<PopupState> {
  const response = (await chrome.runtime.sendMessage(message)) as PopupResponse | undefined;
  if (!response || response.ok !== true)
    throw new Error(
      response && 'error' in response
        ? response.error
        : 'The extension did not respond. Close and reopen Handrail.',
    );
  return response.state;
}
async function command(
  type: PopupMessage['type'],
  fields: Omit<PopupMessage, 'source' | 'type'> = {},
  success = '',
): Promise<boolean> {
  if (busy) return false;
  busy = true;
  discardId = '';
  render();
  try {
    state = await request({ source: 'popup', type, ...fields });
    lastState = JSON.stringify(state);
    notice(success || '');
    return true;
  } catch (error) {
    notice(error instanceof Error ? error.message : 'The operation could not finish.', true);
    return false;
  } finally {
    busy = false;
    render();
  }
}
async function importFile(file: File): Promise<void> {
  if (file.size > MAX_JSON_BYTES) {
    notice('Guide JSON must be no larger than 256 KiB.', true);
    render();
    return;
  }
  try {
    const guide = parseGuideJson(await file.text());
    if (state?.guides.some((saved) => saved.id === guide.id)) {
      // Keep import reversible: retain both copies instead of silently overwriting.
      guide.id = crypto.randomUUID();
    }
    if (
      await command(
        'SAVE_GUIDE',
        { guide },
        'Guide imported. Review its site, labels and instructions before replaying.',
      )
    ) {
      selectedId = guide.id;
      draft = null;
      editing = false;
      render();
    }
  } catch (error) {
    notice(error instanceof Error ? error.message : 'This guide could not be imported.', true);
    render();
  }
}
function exportGuide(guide: Guide): void {
  const checked = validateGuide(guide);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(checked, null, 2) + '\n'], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${
    checked.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'handrail-guide'
  }.handrail.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  notice(
    'Guide exported. Its paths, labels, selectors and instructions can contain page content; review before sharing.',
  );
  render();
}
function header(): HTMLElement {
  const brand = el(
    'div',
    'brand',
    el('span', 'brand-mark', '⌁'),
    el('div', '', el('h1', '', 'handrail'), el('p', '', 'A little guidance.')),
  );
  const file = el('input');
  file.type = 'file';
  file.accept = '.json,application/json';
  file.hidden = true;
  file.setAttribute('aria-label', 'Import guide file');
  file.addEventListener('change', () => {
    const selected = file.files?.[0];
    if (selected) void importFile(selected);
  });
  const importButton = button('Import guide', () => file.click(), {
    disabled: editing || (state?.guides.length ?? 0) >= MAX_GUIDES,
    testid: 'import-guide',
  });
  const wrapper = el('header', '', brand, importButton, file);
  return wrapper;
}
function sessionPanel(): HTMLElement | null {
  const session = state?.session;
  if (!session) return null;
  const record = session.mode === 'record';
  const heading =
    session.status === 'complete'
      ? 'You followed the guide.'
      : record
        ? 'Recording your clicks.'
        : 'One step at a time.';
  const pill = el(
    'span',
    `pill ${session.status}`,
    session.status === 'complete'
      ? 'COMPLETE'
      : session.status === 'paused'
        ? 'PAUSED'
        : record
          ? 'RECORDING'
          : 'FOLLOWING',
  );
  const top = el('div', 'section-top', el('span', 'eyebrow', 'CURRENT SESSION'), pill);
  const counter = record
    ? `${session.guide.steps.length} / 40 steps captured`
    : `${Math.min(session.stepIndex + 1, session.guide.steps.length)} / ${session.guide.steps.length} steps`;
  const panel = el(
    'section',
    'session-panel',
    top,
    el('h2', '', heading),
    el('strong', 'session-name', session.guide.name),
    el('p', 'small break-word', session.origin),
    el('p', 'counter', counter),
  );
  panel.dataset.testid = 'session-panel';
  if (session.reason) {
    const reason = el('p', 'session-reason', session.reason);
    reason.dataset.testid = 'session-reason';
    panel.append(reason);
  }
  if (!record && session.status !== 'complete') {
    const step = session.guide.steps[session.stepIndex];
    if (step)
      panel.append(
        el(
          'div',
          'current-step',
          el('span', 'eyebrow', 'NEXT STEP'),
          el('p', '', step.instruction),
          el('code', 'break-word', step.pathname),
        ),
      );
  }
  if (state?.activeTab.id !== session.tabId)
    panel.append(
      el(
        'p',
        'small warning',
        'This session belongs to another tab. Return to that tab to resume; saving or stopping is still available here.',
      ),
    );
  const actions = el('div', 'actions');
  if (session.status === 'active')
    actions.append(
      button('Pause', () => command('PAUSE').then(() => undefined), { testid: 'pause-session' }),
    );
  if (session.status === 'paused')
    actions.append(
      button('Resume', () => command('RESUME').then(() => undefined), {
        primary: true,
        disabled: state?.activeTab.id !== session.tabId || !state.activeTab.eligible,
        testid: 'resume-session',
      }),
    );
  if (record) {
    actions.append(
      button(
        'Save recording',
        async () => {
          const id = session.guide.id;
          if (
            await command(
              'STOP',
              { save: true },
              'Guide saved on this browser. Review its instructions before sharing.',
            )
          ) {
            selectedId = id;
            render();
          }
        },
        { primary: true, disabled: session.guide.steps.length === 0, testid: 'save-recording' },
      ),
    );
    if (discardId === 'recording') {
      const confirmation = el(
        'div',
        'confirmation',
        el('p', '', 'Discard these captured steps? Saved guides are unaffected.'),
        button('Keep recording', () => {
          discardId = '';
          render();
        }),
        button(
          'Discard captured steps',
          () => command('STOP', { save: false }, 'Recording discarded.').then(() => undefined),
          { danger: true },
        ),
      );
      panel.append(confirmation);
    } else
      actions.append(
        button(
          'Discard',
          () => {
            discardId = 'recording';
            render();
          },
          { danger: true },
        ),
      );
  } else
    actions.append(
      button(
        'Stop guide',
        () =>
          command('STOP', { save: false }, 'Guide stopped. Your saved copy is unchanged.').then(
            () => undefined,
          ),
        { testid: 'stop-session' },
      ),
    );
  panel.append(
    actions,
    el(
      'p',
      'small',
      record
        ? 'Close this popup and use ordinary buttons or links on the page. Form controls and their values are not recorded.'
        : 'Only your own click on the highlighted control advances the guide.',
    ),
  );
  return panel;
}
function recordPanel(): HTMLElement {
  const disabled =
    busy ||
    !state?.activeTab.eligible ||
    !!(state.session && state.session.status !== 'complete') ||
    editing;
  const form = el('form', 'record-panel');
  form.append(
    el(
      'div',
      'section-top',
      el('span', 'eyebrow', 'SHOW IT ONCE'),
      el('span', 'little-arrow', '↗'),
    ),
    el('h2', '', 'Make a useful little guide.'),
    field('Guide name', newName, 80, (value) => {
      newName = value;
    }),
    field(
      'Description (optional)',
      newDescription,
      400,
      (value) => {
        newDescription = value;
      },
      true,
    ),
  );
  const nameInput = form.querySelector('input')!;
  nameInput.required = true;
  nameInput.placeholder = 'e.g. Find the opening hours';
  for (const input of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'input,textarea',
  ))
    input.disabled = disabled;
  const start = el('button', 'primary full', 'Start recording');
  start.type = 'submit';
  start.disabled = disabled;
  start.dataset.testid = 'start-recording';
  form.append(
    start,
    el(
      'p',
      'small',
      'Recording starts only after your action. Review captured labels and selectors before exporting.',
    ),
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      if (
        await command('START_RECORD', { name: newName.trim(), description: newDescription.trim() })
      ) {
        newName = '';
        newDescription = '';
        render();
      }
    })();
  });
  return form;
}
function guideDetails(guide: Guide): HTMLElement {
  const panel = el('section', 'guide-detail');
  panel.dataset.testid = 'guide-details';
  panel.append(
    el(
      'div',
      'section-top',
      el('span', 'eyebrow', editing ? 'EDIT LOCAL GUIDE' : 'YOUR SAVED GUIDE'),
      el('span', 'small', `${guide.steps.length} steps`),
    ),
  );
  const sessionOwns = state?.session?.guide.id === guide.id;
  if (editing && draft?.id === guide.id) {
    const currentDraft = draft;
    panel.append(
      field('Guide name', currentDraft.name, 80, (value) => {
        currentDraft.name = value;
      }),
      field(
        'Guide description',
        currentDraft.description,
        400,
        (value) => {
          currentDraft.description = value;
        },
        true,
      ),
      el('p', 'small break-word', currentDraft.origin),
      el(
        'p',
        'small',
        'Selectors and paths come from recording. Record a changed control again instead of editing its identity.',
      ),
    );
    const steps = el('ol', 'edit-steps');
    currentDraft.steps.forEach((step, index) => {
      const row = el(
        'li',
        '',
        el('div', 'target-line', el('strong', '', step.name), el('span', 'small', `${index + 1}`)),
        el('code', 'break-word', step.pathname),
        field(
          `Instruction for step ${index + 1}`,
          step.instruction,
          240,
          (value) => {
            step.instruction = value;
          },
          true,
        ),
      );
      row.append(
        button(
          `Remove step ${index + 1}`,
          () => {
            currentDraft.steps.splice(index, 1);
            render();
          },
          { danger: true, disabled: currentDraft.steps.length < 2 },
        ),
      );
      steps.append(row);
    });
    panel.append(
      steps,
      el(
        'div',
        'actions',
        button(
          'Save changes',
          async () => {
            try {
              const checked = validateGuide(currentDraft);
              if (await command('SAVE_GUIDE', { guide: checked }, 'Guide changes saved locally.')) {
                editing = false;
                draft = null;
                render();
              }
            } catch (error) {
              notice(error instanceof Error ? error.message : 'Review this guide.', true);
              render();
            }
          },
          { primary: true, testid: 'save-guide-changes' },
        ),
        button('Cancel editing', () => {
          editing = false;
          draft = null;
          notice('Editing cancelled. The saved guide is unchanged.');
          render();
        }),
      ),
    );
  } else {
    panel.append(el('h3', '', guide.name));
    if (guide.description) panel.append(el('p', '', guide.description));
    panel.append(el('p', 'small break-word site-origin', guide.origin));
    const steps = el('ol', 'saved-steps');
    for (const step of guide.steps)
      steps.append(
        el(
          'li',
          '',
          el('strong', '', step.instruction),
          el('span', 'small', `Target: ${step.name}`),
          el('code', 'break-word', step.pathname),
        ),
      );
    panel.append(steps);
    const currentOrigin = (() => {
      try {
        return new URL(state?.activeTab.url ?? '').origin;
      } catch {
        return '';
      }
    })();
    const canPlay =
      !!state?.activeTab.eligible &&
      currentOrigin === guide.origin &&
      (!state.session || state.session.status === 'complete');
    panel.append(
      el(
        'div',
        'actions',
        button(
          'Follow this guide',
          () => command('START_REPLAY', { guideId: guide.id }).then(() => undefined),
          { primary: true, disabled: !canPlay, testid: 'follow-guide' },
        ),
        button(
          'Edit instructions',
          () => {
            editing = true;
            draft = copyGuide(guide);
            notice('');
            render();
          },
          { disabled: !!sessionOwns, testid: 'edit-guide' },
        ),
        button('Export JSON', () => exportGuide(guide), { testid: 'export-guide' }),
      ),
    );
    if (!canPlay)
      panel.append(
        el(
          'p',
          'small',
          state?.session && state.session.status !== 'complete'
            ? 'Save or stop the current session before starting another guide.'
            : 'Open this guide’s exact site origin and invoke Handrail there to follow it.',
        ),
      );
    if (discardId === guide.id)
      panel.append(
        el(
          'div',
          'confirmation',
          el(
            'p',
            '',
            'Delete this saved guide from this browser? Export a copy first if you want to keep it.',
          ),
          el(
            'div',
            'actions',
            button('Keep guide', () => {
              discardId = '';
              render();
            }),
            button(
              'Delete saved guide',
              async () => {
                if (
                  await command(
                    'DELETE_GUIDE',
                    { guideId: guide.id },
                    'Guide deleted from this browser.',
                  )
                ) {
                  selectedId = '';
                  render();
                }
              },
              { danger: true, testid: 'confirm-delete-guide' },
            ),
          ),
        ),
      );
    else
      panel.append(
        button(
          'Delete guide',
          () => {
            discardId = guide.id;
            render();
          },
          { danger: true, disabled: !!sessionOwns, testid: 'delete-guide' },
        ),
      );
  }
  return panel;
}
function library(): HTMLElement {
  const guides = state?.guides ?? [];
  const section = el(
    'section',
    'library',
    el(
      'div',
      'section-top',
      el('span', 'eyebrow', 'YOUR LOCAL LIBRARY'),
      el('span', 'small', `${guides.length} / ${MAX_GUIDES}`),
    ),
    el('h2', '', 'A handrail for next time.'),
  );
  if (!guides.length)
    section.append(
      el(
        'div',
        'empty-state',
        el('span', '', '⌁'),
        el('p', '', 'No saved guides yet.'),
        el('p', 'small', 'Record a few clicks, or import a guide someone shared with you.'),
      ),
    );
  else {
    const list = el('ul', 'guide-list');
    list.setAttribute('aria-label', 'Saved guides');
    for (const guide of guides) {
      const select = button(
        guide.name,
        () => {
          selectedId = guide.id;
          editing = false;
          draft = null;
          discardId = '';
          notice('');
          render();
        },
        { disabled: editing, testid: 'select-guide' },
      );
      select.className = `guide-choice${selectedId === guide.id ? ' selected' : ''}`;
      select.setAttribute('aria-pressed', String(selectedId === guide.id));
      select.append(el('span', 'guide-count', `${guide.steps.length} steps`));
      list.append(el('li', '', select));
    }
    section.append(list);
  }
  const selected = activeGuide();
  if (selected) section.append(guideDetails(selected));
  return section;
}
function render(): void {
  const container = el('div', 'popup-shell', header());
  const status = el(
    'p',
    `notice${isError ? ' error' : ''}`,
    busy ? 'Working on your local guide…' : message,
  );
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'popup-status';
  container.append(status);
  if (!state)
    container.append(
      el(
        'main',
        'loading-state',
        el('h2', '', isError ? 'Handrail could not open.' : 'Opening your guides…'),
        el(
          'p',
          'small',
          isError
            ? 'Close this popup and invoke the extension again from the toolbar.'
            : 'Saved guides stay in this browser.',
        ),
      ),
    );
  else {
    const page = el(
      'section',
      'page-context',
      el('span', 'eyebrow', 'CURRENT PAGE'),
      el('p', 'break-word', state.activeTab.url || state.activeTab.reason),
    );
    if (!state.activeTab.eligible && state.activeTab.url)
      page.append(el('p', 'small', state.activeTab.reason));
    const session = sessionPanel();
    container.append(el('main', '', page, session, recordPanel(), library()));
  }
  container.append(
    el(
      'footer',
      '',
      el('p', '', 'Your clicks. Your pace. Your browser.'),
      el(
        'nav',
        '',
        link('Source ↗', 'https://github.com/ufodia/handrail'),
        link('Buy ufodia a coffee ↗', 'https://buymeacoffee.com/ufodia'),
      ),
    ),
  );
  root!.replaceChildren(container);
}
async function refresh(): Promise<void> {
  if (busy || editing || stopped) return;
  try {
    const next = await request({ source: 'popup', type: 'GET_STATE' });
    if (stopped) return;
    const key = JSON.stringify(next);
    state = next;
    if (selectedId && !next.guides.some((guide) => guide.id === selectedId)) selectedId = '';
    if (key !== lastState) {
      lastState = key;
      render();
    }
  } catch (error) {
    if (!state) {
      notice(error instanceof Error ? error.message : 'Could not read local guides.', true);
      render();
    }
  }
}
render();
void refresh();
const polling = window.setInterval(() => {
  void refresh();
}, 1000);
window.addEventListener('pagehide', () => {
  stopped = true;
  clearInterval(polling);
});
