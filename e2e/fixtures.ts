import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type CDPSession,
  type Page,
  type Worker,
} from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

type Session = {
  status: string;
  mode: string;
  stepIndex: number;
  guide: { id: string; steps: Array<{ name: string; selector: string; pathname: string }> };
  reason: string;
};
type State = { session: Session | null; guides: Array<any> };

/** Real action popups are CDP targets, not ordinary tabs in Playwright. */
export class ActionPopup {
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly cdp: CDPSession,
    private readonly sessionId: string,
    readonly targetId: string,
  ) {
    cdp.on('Target.receivedMessageFromTarget', this.onMessage);
  }
  private onMessage = (event: { sessionId: string; message: string }) => {
    if (event.sessionId !== this.sessionId) return;
    const payload = JSON.parse(event.message);
    const request = this.pending.get(payload.id);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(payload.id);
    if (payload.error) request.reject(new Error(JSON.stringify(payload.error)));
    else request.resolve(payload.result);
  };
  async send(method: string, params: object = {}): Promise<any> {
    if (this.closed) throw new Error('The action popup is already closed.');
    const id = ++this.nextId;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Popup CDP ${method} timed out.`));
      }, 10_000);
      this.pending.set(id, { resolve, reject, timer });
    });
    void this.cdp
      .send('Target.sendMessageToTarget', {
        sessionId: this.sessionId,
        message: JSON.stringify({ id, method, params }),
      })
      .catch((error) => {
        const request = this.pending.get(id);
        if (!request) return;
        clearTimeout(request.timer);
        this.pending.delete(id);
        request.reject(error);
      });
    return result;
  }
  async evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T> {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', {
      expression: `(${fn.toString()})(${arg === undefined ? 'undefined' : JSON.stringify(arg)})`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (exceptionDetails)
      throw new Error(
        exceptionDetails.text + ': ' + (exceptionDetails.exception?.description ?? ''),
      );
    return result.value as T;
  }
  async text(): Promise<string> {
    return this.evaluate(() => document.body.innerText);
  }
  async has(testId: string): Promise<boolean> {
    return this.evaluate((id) => !!document.querySelector(`[data-testid="${id}"]`), testId);
  }
  async click(testId: string): Promise<void> {
    await expect
      .poll(() =>
        this.evaluate((id) => {
          const element = document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
          return !!element && !element.disabled;
        }, testId),
      )
      .toBe(true);
    const point = await this.evaluate((id) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }, testId);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      button: 'left',
      clickCount: 1,
      ...point,
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      button: 'left',
      clickCount: 1,
      ...point,
    });
  }
  async fill(label: string, value: string): Promise<void> {
    await expect
      .poll(() =>
        this.evaluate((label) => {
          const wrapper = Array.from(document.querySelectorAll('label')).find(
            (node) => node.querySelector('span')?.textContent === label,
          );
          const input = wrapper?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
            'input,textarea',
          );
          return !!input && !input.disabled;
        }, label),
      )
      .toBe(true);
    await this.evaluate((label) => {
      const wrapper = Array.from(document.querySelectorAll('label')).find(
        (node) => node.querySelector('span')?.textContent === label,
      );
      const input = wrapper?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input,textarea',
      );
      if (!input) throw new Error(`Missing popup field ${label}`);
      input.focus();
      input.select();
    }, label);
    await this.send('Input.insertText', { text: value });
  }
  async importFile(filename: string): Promise<void> {
    const { root } = await this.send('DOM.getDocument');
    const { nodeId } = await this.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: 'input[type="file"]',
    });
    if (!nodeId) throw new Error('Missing popup import control.');
    await this.send('DOM.setFileInputFiles', { nodeId, files: [filename] });
  }
  async screenshot(filename: string): Promise<void> {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(filename, Buffer.from(data, 'base64'));
  }
  async close(): Promise<void> {
    this.release();
    await this.cdp.send('Target.closeTarget', { targetId: this.targetId }).catch(() => undefined);
    await expect
      .poll(async () => {
        const { targetInfos } = await this.cdp.send('Target.getTargets', { filter: [{}] });
        return !targetInfos.some((target: any) => target.targetId === this.targetId);
      })
      .toBe(true);
  }
  /** Release a provisional attachment without closing the real action popup. */
  async detach(): Promise<void> {
    this.release();
    await this.cdp
      .send('Target.detachFromTarget', { sessionId: this.sessionId })
      .catch(() => undefined);
  }
  private release(): void {
    if (this.closed) return;
    this.closed = true;
    this.cdp.off('Target.receivedMessageFromTarget', this.onMessage);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('Popup attachment closed.'));
    }
    this.pending.clear();
  }
}

export class ExtensionHarness {
  popup?: ActionPopup;
  readonly popupLifecycle: string[] = [];
  constructor(
    readonly context: BrowserContext,
    readonly page: Page,
    readonly worker: Worker,
    readonly id: string,
    readonly cdp: CDPSession,
  ) {}
  async state(): Promise<State> {
    return this.worker.evaluate(async () => {
      const local = await chrome.storage.local.get('handrail-guides-v1');
      const session = await chrome.storage.session.get('handrail-session-v1');
      return {
        guides: local['handrail-guides-v1'] ?? [],
        session: session['handrail-session-v1'] ?? null,
      };
    });
  }
  async seed(guides: unknown[]): Promise<void> {
    await this.worker.evaluate(
      (guides) => chrome.storage.local.set({ 'handrail-guides-v1': guides }),
      guides,
    );
  }
  async openPopup(): Promise<ActionPopup> {
    await this.popup?.close();
    this.popup = undefined;
    await this.page.bringToFront();
    const popupUrl = `chrome-extension://${this.id}/popup.html`;
    const existing = (await this.cdp.send('Target.getTargets', { filter: [{}] })).targetInfos;
    // An old native popup may be closing even after its CDP close acknowledgment.
    // Clear only this isolated test extension's exact popup, then observe its end.
    for (const old of existing.filter((item: any) => item.url === popupUrl))
      await this.cdp.send('Target.closeTarget', { targetId: old.targetId });
    await expect
      .poll(async () => {
        const { targetInfos } = await this.cdp.send('Target.getTargets', { filter: [{}] });
        return targetInfos.every((item: any) => item.url !== popupUrl);
      })
      .toBe(true);
    const { targetInfos } = await this.cdp.send('Target.getTargets', { filter: [{}] });
    const beforeInvocation = new Set(targetInfos.map((item: any) => item.targetId));
    const target = targetInfos.find(
      (item: any) => item.type === 'tab' && item.url === this.page.url(),
    );
    if (!target) throw new Error('The practice tab target is missing.');
    this.popupLifecycle.push(`Invoking action on tab ${target.targetId}`);
    await this.cdp.send('Extensions.triggerAction', { id: this.id, targetId: target.targetId });
    let provisional: ActionPopup | undefined;
    let reattachments = 0;
    await expect
      .poll(async () => {
        const popupTarget = (
          await this.cdp.send('Target.getTargets', { filter: [{}] })
        ).targetInfos.find(
          (item: any) => item.url === popupUrl && !beforeInvocation.has(item.targetId),
        );
        if (!popupTarget) return false;
        if (provisional?.targetId !== popupTarget.targetId) {
          await provisional?.detach();
          const { sessionId } = await this.cdp.send('Target.attachToTarget', {
            targetId: popupTarget.targetId,
            flatten: false,
          });
          provisional = new ActionPopup(this.cdp, sessionId, popupTarget.targetId);
          this.popupLifecycle.push(`Attached fresh popup ${popupTarget.targetId}`);
        }
        try {
          return await provisional!.evaluate(
            (url) =>
              location.href === url &&
              document.readyState === 'complete' &&
              !!document.querySelector('[data-testid="popup-status"]'),
            popupUrl,
          );
        } catch (error) {
          // Chrome can replace the initial blank popup renderer during commit.
          // Rebind only before any UI operation, and never retry an app action.
          if (
            !/No session with given id|Session closed|Target closed/.test(String(error)) ||
            reattachments >= 2
          )
            throw error;
          this.popupLifecycle.push(`Initial renderer detached; reattachment ${++reattachments}`);
          await provisional!.detach();
          provisional = undefined;
          return false;
        }
      })
      .toBe(true);
    this.popup = provisional!;
    this.popupLifecycle.push(`Ready popup ${provisional!.targetId}`);
    return provisional!;
  }
}

export const test = base.extend<{ extension: ExtensionHarness }>({
  extension: async ({}, use, testInfo) => {
    const extensionPath = path.resolve('extension-dist');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      viewport: { width: 1280, height: 900 },
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--enable-unsafe-extension-debugging',
      ],
    });
    const errors: string[] = [];
    context.on('page', (page) => page.on('pageerror', (error) => errors.push(error.message)));
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await context.browser()!.newBrowserCDPSession();
    const harness = new ExtensionHarness(context, page, worker, id, cdp);
    try {
      await use(harness);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await mkdir(testInfo.outputDir, { recursive: true });
        await page
          .screenshot({ path: testInfo.outputPath('extension-page.png'), fullPage: true })
          .catch(() => undefined);
        await harness.popup
          ?.screenshot(testInfo.outputPath('extension-popup.png'))
          .catch(() => undefined);
        await testInfo.attach('extension-errors', {
          body: JSON.stringify(errors),
          contentType: 'application/json',
        });
        await testInfo.attach('popup-lifecycle', {
          body: JSON.stringify(harness.popupLifecycle, null, 2),
          contentType: 'application/json',
        });
      }
      await harness.popup?.close();
      await context.close();
    }
  },
});
export { expect };

export function guideFixture(
  origin = 'http://127.0.0.1:4173',
  overrides: Record<string, unknown> = {},
): any {
  return {
    version: 1,
    id: 'practice-guide',
    name: 'Open practice preferences',
    description: 'A local browser test guide.',
    origin,
    steps: [
      {
        id: 'open',
        pathname: '/practice.html',
        selector: '#open-preferences',
        tag: 'button',
        role: 'button',
        name: 'Open preferences',
        instruction: 'Open the practice preferences.',
      },
    ],
    ...overrides,
  };
}
