# Contribute a clearer next step

Handrail is maintained by ufodia under MIT. Useful contributions improve browser compatibility, target matching, privacy boundaries, accessible instructions and reproducible examples.

## Work locally

Use Node.js 24, run `npm ci`, then `npm run verify`. The build creates the unpacked extension and installation site. Use [isolated browser testing](docs/testing.md); never install automated test builds into an everyday signed-in browser profile.

Keep changes focused and explain the problem, resulting behaviour and checks. Run relevant unit/browser workflows and inspect formatting with `npm run format:check`. Document any proposed saved-file change before breaking version 1 guide compatibility.

## Preserve the access contract

The extension requests `storage`, `activeTab` and `scripting`. Do not add permanent all-site access, automatic clicks or captured form values as a shortcut around a failing test. Missing or changed controls should pause for review rather than select a guessed target.

For a matching/navigation bug, include a source-controlled minimal page and a nonprivate guide with exact steps. Test actual extension invocation, trusted clicks and the correct document/progress binding where relevant.

## Protect examples and dependencies

Use synthetic practice content. Paths, selectors and labels can carry private context even without input values. Do not commit user guide exports, browser profiles, credentials, generated outputs or private screenshots. Keep dependency licenses and the lockfile intact when changing tools.

Report sensitive findings through [SECURITY.md](SECURITY.md). Public discussions follow the [code of conduct](CODE_OF_CONDUCT.md).
