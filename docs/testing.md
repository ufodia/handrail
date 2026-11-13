# Verify a real extension in an isolated browser

Use this guide with Handrail 0.1.0. A static popup screenshot or mocked Chrome API alone does not demonstrate temporary page access, actual click capture or navigation behaviour.

## Source checks

Use Node.js 24 and the locked dependencies:

```sh
npm ci
npm run verify
```

`verify` runs strict TypeScript, unit tests, the extension build and the Vite site build. The extension build produces three classic IIFEs plus the reviewed manifest/assets and a ZIP. It does not install the extension into a browser.

The unit suite checks version/schema limits, URL normalization, restricted selectors, sender identity and pure recording/replay progress rules. Review actual test results for the source commit you intend to distribute.

## Browser checks

```sh
npx playwright install --no-shell chromium
npm run test:e2e
```

Browser QA uses bundled full Chromium in an isolated persistent test profile. It must not load test builds into your everyday signed-in Chrome or Edge profile. An actual extension-action invocation grants the test page's `activeTab` access; opening a popup URL alone is insufficient evidence of that permission path.

Verify the browser results against these behaviours:

- Real clicks record supported controls and do not capture text-field values.
- Save/edit/import/export preserve the bounded version 1 guide contract.
- Real user clicks, rather than programmatic page clicks, advance replay.
- Missing, ambiguous, changed, hidden or disabled targets pause without guessing.
- Same-origin navigation reconnects while permitted; changed origins pause.
- Stale tokens, documents, frames and progress are rejected.
- Stopping removes the overlay and active observers.
- The generated ZIP contains the expected extension files, and the static installation/practice pages remain usable.

Screenshots of the actual test extension describe that browser run. They do not establish compatibility with every browser version, website, translated label, embedded frame or assistive-technology configuration.

## Manual compatibility check

1. Build the reviewed source and load `extension-dist/` into a separate browser profile you intend to use for testing.
2. Invoke the toolbar action on the included practice desk, record its preferences route and save the guide.
3. Reload the desk, follow the guide, and confirm every task action is your own click.
4. Pause/resume, move to the summary page, stop, export and reimport the guide.
5. Try the intended target website with nonconsequential test data. Recheck after website or browser changes.

Do not treat a permission failure as a reason to add broad host permissions to a test build. Preserve the production manifest's access contract and report the exact limitation.

## Report a reproducible failure

Include the source SHA, browser/OS, whether the test profile used the toolbar action, exact page origin/path, expected behaviour and a minimal nonprivate guide. For target changes, describe the current tag, role and label. Redact private paths, IDs, labels and instructions before posting publicly.

See [Playwright's extension testing guidance](https://playwright.dev/docs/chrome-extensions) and [Chrome's activeTab documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) for the underlying browser constraints.
