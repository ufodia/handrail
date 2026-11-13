# Restore source and guides separately

The repository contains Handrail's first-party extension/site source, non-secret manifest and configuration, dependency lockfile, icons, build scripts, practice pages and documentation. Your browser's saved guide library is user data and needs its own exported JSON backup.

## Restore a development computer

Install Git and Node.js 24 LTS:

```sh
git clone https://github.com/ufodia/handrail.git
cd handrail
git switch main
git pull --ff-only origin main
git rev-parse HEAD
npm ci
npm run verify
```

Record the printed full SHA for an exact source reference. The build recreates `extension-dist/`, `public/downloads/handrail.zip` and the static site's `dist/` output. Those generated artifacts are ignored by Git.

Normal builds do not need a Chromium binary. Browser testing and optional icon regeneration do:

```sh
npx playwright install --no-shell chromium
npm run test:e2e
```

The tracked PNG icons are ready for a normal build. If you intentionally change `public/favicon.svg`, run `npm run generate:icons` with Chromium installed, inspect the regenerated icons and commit the reviewed source assets.

## Restore a user's guide library

Manually load the rebuilt or extracted extension folder as described in the [guide](guide.md). Open the popup's **Import guide** control and import each reviewed `.handrail.json` backup. Guides remain tied to their saved origin, path and target identities; test them against the current website before relying on them.

The source repository does not contain another browser's local storage, page grants, unsaved recording draft, signed-in website sessions or exported files. Do not copy an everyday browser profile into automated tests to restore those states.

## Update carefully

Inspect `git status` and preserve local changes before a fast-forward pull from `origin/main`. Run `npm ci`, repeat the checks and rebuild. Reload the installed extension and target page to use the new reviewed code. Keep the chosen unpacked folder in place.

Export important guides before replacing/removing an installed extension or moving to a different browser profile. Browser-assigned extension identities and storage lifetimes are separate from the source checkout.
