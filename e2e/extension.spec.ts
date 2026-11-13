import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { test, expect, guideFixture } from './fixtures';

const practice = 'http://127.0.0.1:4173/practice.html';
const overlay = '#handrail-overlay';

test('real action popup records, edits, exports and replays trusted clicks across a same-origin navigation', async ({
  extension,
}, testInfo) => {
  const { page } = extension;
  await page.goto(practice + '?private=QUERY_SECRET#FRAGMENT_SECRET');
  let popup = await extension.openPopup();
  await popup.fill('Guide name', 'Practice preferences');
  await popup.fill('Description (optional)', 'A route made by real user clicks.');
  await popup.click('start-recording');
  await expect.poll(async () => (await extension.state()).session?.status).toBe('active');
  await popup.close();
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(1);
  await page.getByLabel('Practice display name').fill('FORM_VALUE_SECRET');
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(2);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(3);
  await page.getByRole('link', { name: 'Continue to summary', exact: false }).click();
  await expect(page).toHaveURL(/\/practice-next\.html$/);
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(4);
  await expect(page.locator(overlay).getByRole('region', { name: 'Handrail guide' })).toBeVisible();
  await page.getByRole('button', { name: 'Finish practice', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(5);
  await page.locator(overlay).getByRole('button', { name: 'Save recording', exact: true }).click();
  await expect.poll(async () => (await extension.state()).guides.length).toBe(1);
  await expect.poll(async () => (await extension.state()).session).toBeNull();
  const captured = (await extension.state()).guides[0];
  expect(captured.steps.map((step: any) => step.name)).toEqual([
    'Open preferences',
    'Notifications',
    'Save preferences',
    'Continue to summary →',
    'Finish practice',
  ]);
  expect(JSON.stringify(captured)).not.toMatch(/FORM_VALUE_SECRET|QUERY_SECRET|FRAGMENT_SECRET/);
  expect(captured.steps[4].pathname).toBe('/practice-next.html');

  await page.goto(practice);
  popup = await extension.openPopup();
  await popup.click('select-guide');
  await popup.click('edit-guide');
  const instruction = 'Open preferences <img src=x onerror="alert(1)"> safely.';
  await popup.fill('Instruction for step 1', instruction);
  await popup.click('save-guide-changes');
  await expect
    .poll(async () => (await extension.state()).guides[0]?.steps[0].instruction)
    .toBe(instruction);
  expect(
    await popup.evaluate(
      () => document.querySelectorAll('#popup-app img,#popup-app script:not([src])').length,
    ),
  ).toBe(0);

  const downloads = testInfo.outputPath('downloads');
  await mkdir(downloads, { recursive: true });
  await extension.cdp.send('Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloads,
    eventsEnabled: true,
  });
  let filename = '',
    complete = false,
    guid = '';
  extension.cdp.on('Browser.downloadWillBegin', (event) => {
    filename = event.suggestedFilename;
    guid = event.guid;
  });
  extension.cdp.on('Browser.downloadProgress', (event) => {
    if (event.guid === guid && event.state === 'completed') complete = true;
  });
  await popup.click('export-guide');
  await expect.poll(() => complete).toBe(true);
  const exported = JSON.parse(await readFile(path.join(downloads, filename), 'utf8'));
  expect(exported.steps[0].instruction).toBe(instruction);
  expect(JSON.stringify(exported)).not.toContain('FORM_VALUE_SECRET');

  await popup.click('follow-guide');
  await expect.poll(async () => (await extension.state()).session?.status).toBe('active');
  await popup.close();
  await expect(page.locator(overlay)).toContainText(instruction);
  expect(
    await page
      .getByRole('button', { name: 'Open preferences', exact: true })
      .evaluate((element) => element.getAttribute('aria-expanded')),
  ).toBeNull();
  await page.getByRole('button', { name: 'Open preferences', exact: true }).dispatchEvent('click');
  expect((await extension.state()).session?.stepIndex).toBe(0);
  // Reset the demonstration's own response to the synthetic click, then use real input.
  await page.evaluate(() => {
    document.getElementById('preferences')!.hidden = true;
  });
  await page.getByRole('button', { name: 'Open preferences', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.stepIndex).toBe(1);
  await mkdir(path.resolve('docs/assets'), { recursive: true });
  await page.screenshot({ path: path.resolve('docs/assets/workspace.png'), fullPage: true });
  await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.stepIndex).toBe(2);
  await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.stepIndex).toBe(3);
  await page.getByRole('link', { name: 'Continue to summary', exact: false }).click();
  await expect(page).toHaveURL(/\/practice-next\.html$/);
  await expect.poll(async () => (await extension.state()).session?.stepIndex).toBe(4);
  await page.getByRole('button', { name: 'Finish practice', exact: true }).click();
  await expect.poll(async () => (await extension.state()).session?.status).toBe('complete');
  await expect(page.locator(overlay)).toContainText('You completed every step yourself.');
});

test('import validates schema, keeps hostile text inert, and rejects a forged popup sender', async ({
  extension,
}, testInfo) => {
  await extension.page.goto(practice);
  const popup = await extension.openPopup();
  const invalid = testInfo.outputPath('invalid.json');
  await writeFile(
    invalid,
    JSON.stringify(
      guideFixture(undefined, {
        steps: [{ ...guideFixture().steps[0], selector: 'button, input' }],
      }),
    ),
  );
  await popup.importFile(invalid);
  await expect.poll(() => popup.text()).toMatch(/selector|bounded|Record/i);
  expect((await extension.state()).guides).toHaveLength(0);
  const hostile = 'A guide <img src=x onerror="alert(1)">';
  const valid = testInfo.outputPath('valid.json');
  await writeFile(valid, JSON.stringify(guideFixture(undefined, { name: hostile })));
  await popup.importFile(valid);
  await expect.poll(async () => (await extension.state()).guides.length).toBe(1);
  await expect.poll(() => popup.text()).toContain(hostile);
  expect(await popup.evaluate(() => document.querySelectorAll('#popup-app img').length)).toBe(0);
  const forged = await popup.evaluate(() =>
    chrome.runtime.sendMessage({
      source: 'content',
      type: 'STOP_SESSION',
      token: 'fake',
      save: false,
    }),
  );
  expect(forged).toMatchObject({ ok: false, error: 'This sender is not authorized.' });
  const fakePopup = await extension.context.newPage();
  await fakePopup.goto(`chrome-extension://${extension.id}/popup.html?forged=1`);
  const rejected = await fakePopup.evaluate(() =>
    chrome.runtime.sendMessage({
      source: 'popup',
      type: 'DELETE_GUIDE',
      guideId: 'practice-guide',
    }),
  );
  expect(rejected).toMatchObject({ ok: false, error: 'This sender is not authorized.' });
  expect((await extension.state()).guides).toHaveLength(1);
});

for (const mutation of ['missing', 'ambiguous', 'changed label'] as const) {
  test(`replay pauses when the saved target is ${mutation}`, async ({ extension }) => {
    await extension.page.goto(practice);
    await extension.seed([guideFixture()]);
    const popup = await extension.openPopup();
    await popup.click('select-guide');
    await popup.click('follow-guide');
    await popup.close();
    await expect.poll(async () => (await extension.state()).session?.status).toBe('active');
    await extension.page.evaluate((mutation) => {
      const target = document.getElementById('open-preferences')!;
      if (mutation === 'missing') target.remove();
      else if (mutation === 'ambiguous') target.after(target.cloneNode(true));
      else target.textContent = 'A different control';
    }, mutation);
    await expect.poll(async () => (await extension.state()).session?.status).toBe('paused');
    const state = await extension.state();
    expect(state.session?.stepIndex).toBe(0);
    expect(state.session?.reason).toMatch(
      mutation === 'missing' ? /missing/i : mutation === 'ambiguous' ? /ambiguous/i : /changed/i,
    );
  });
}

test('cross-origin navigation revokes the active session until explicit action re-entry', async ({
  extension,
}) => {
  await extension.page.goto(practice);
  await extension.seed([guideFixture()]);
  let popup = await extension.openPopup();
  await popup.click('select-guide');
  await popup.click('follow-guide');
  await popup.close();
  await expect.poll(async () => (await extension.state()).session?.status).toBe('active');
  await extension.page.goto('http://localhost:4173/practice.html');
  await expect.poll(async () => (await extension.state()).session?.status).toBe('paused');
  await expect(extension.page.locator(overlay)).toHaveCount(0);
  await extension.page.goto(practice);
  popup = await extension.openPopup();
  await popup.click('resume-session');
  await popup.close();
  await expect.poll(async () => (await extension.state()).session?.status).toBe('active');
  await expect(
    extension.page.locator(overlay).getByRole('region', { name: 'Handrail guide' }),
  ).toBeVisible();
});

test('recording ignores private or editable external labels and never stores form values', async ({
  extension,
}) => {
  const { page } = extension;
  await page.goto(practice);
  await page.evaluate(() => {
    const area = document.createElement('section');
    area.id = 'privacy-fixture';
    area.style.cssText =
      'max-width:600px;display:flex;flex-direction:column;align-items:flex-start;margin:20px 0 500px';
    area.innerHTML = `
      <textarea id="label-textarea">FORM_DEFAULT_SECRET</textarea>
      <input id="label-input" value="INPUT_VALUE_SECRET">
      <span id="label-editable" contenteditable="true">EDITABLE_SECRET</span>
      <span id="label-private" data-private>PRIVATE_LABEL_SECRET</span>
      <span id="label-hidden" hidden>HIDDEN_LABEL_SECRET</span>
      <span id="label-inert" inert>INERT_LABEL_SECRET</span>
      <form><input type="password" value="PASSWORD_VALUE_SECRET"><span id="label-password">PASSWORD_FORM_SECRET</span></form>
      <span id="label-safe">A visible safe label</span>
      <button id="ref-textarea" aria-labelledby="label-textarea">Textarea labelled control</button>
      <button id="ref-input" aria-labelledby="label-input">Input labelled control</button>
      <button id="ref-editable" aria-labelledby="label-editable">Editable labelled control</button>
      <button id="ref-private" aria-labelledby="label-private">Private labelled control</button>
      <button id="ref-hidden" aria-labelledby="label-hidden">Hidden labelled control</button>
      <button id="ref-inert" aria-labelledby="label-inert">Inert labelled control</button>
      <button id="ref-password" aria-labelledby="label-password">Password form labelled control</button>
      <button id="ref-mixed" aria-labelledby="label-safe label-private">Mixed labelled control</button>
      <button id="ref-safe" aria-labelledby="label-safe">Safe control</button>
      <button id="ref-direct" aria-label="Direct safe label" aria-labelledby="label-private">Direct label wins</button>
      <button id="ref-icon">Continue with icon <svg aria-hidden="true" width="16" height="16"><text>DECORATIVE_SECRET</text></svg></button>
      <button id="ref-hidden-child">Continue visibly <span hidden>HIDDEN_DESC_SECRET</span></button>`;
    document.body.append(area);
  });
  const popup = await extension.openPopup();
  await popup.fill('Guide name', 'Privacy boundary');
  await popup.click('start-recording');
  await popup.close();
  await expect.poll(async () => (await extension.state()).session?.status).toBe('active');
  for (const id of [
    'textarea',
    'input',
    'editable',
    'private',
    'hidden',
    'inert',
    'password',
    'mixed',
  ]) {
    await page.locator(`#ref-${id}`).click();
    await expect(page.locator(overlay)).toContainText('no short, unique label');
  }
  await page.locator('#ref-safe').click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(1);
  await page.locator('#ref-direct').click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(2);
  await page.locator('#ref-icon').click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(3);
  await page.locator('#ref-hidden-child').click();
  await expect.poll(async () => (await extension.state()).session?.guide.steps.length).toBe(4);
  const session = (await extension.state()).session!;
  expect(session.guide.steps.map((step) => step.name)).toEqual([
    'A visible safe label',
    'Direct safe label',
    'Continue with icon',
    'Continue visibly',
  ]);
  expect(JSON.stringify(session.guide)).not.toContain('_SECRET');
});
