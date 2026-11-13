# Publish the installation site and manual-install ZIP

Handrail's Vercel deployment is a static project site with demonstration pages and a generated extension ZIP. It does not install the extension, publish a Web Store listing, run guides remotely or expose a guide-storage service.

## Build the deliverables

Use Node.js 24 and the committed lockfile:

```sh
npm ci
npm run verify
```

The build sequence type-checks source, bundles three classic extension IIFEs into `extension-dist/`, copies the manifest/popup/icons/license, creates `public/downloads/handrail.zip` from an explicit file list, and runs Vite to emit `dist/`.

The public ZIP is generated from tracked source on every build. Do not commit a stale ZIP as a substitute for the source, lockfile and build scripts. The installed Chromium used for tests/icon regeneration is not needed for a normal deployment build.

## Vercel settings

Import the repository and keep `main` as the production branch. The tracked `vercel.json` specifies Vite, `npm ci`, `npm run build` and `dist/`. No application secrets or environment variables are required.

After publication, confirm the actual production URL and Vercel source commit match checked GitHub `main`. Open the site, download the ZIP, inspect its manifest/file list and open both practice pages. Confirm source/support links and manual-install instructions. A source build alone is not evidence that a deployment succeeded.

Saved user guides and browser page grants do not belong in the hosted site or repository. The production sitemap should describe intended public project URLs, not preview deployments or private guide files.
