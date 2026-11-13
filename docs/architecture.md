# How Handrail stays beside the page

Handrail 0.1.0 contains a Manifest V3 extension and a separate static installation/practice site. The extension has a popup, a service worker and an injected top-frame content script. It has no application server, remote guide store or automatic click engine.

## Explicit temporary page access

The manifest requests `storage`, `activeTab` and `scripting`. Invoking the extension action grants temporary access to the active tab's origin. The service worker then injects the bundled `content.js` into frame 0.

Same-origin navigation can retain that grant. The service worker observes the session tab's updates and reconnects to a completed same-origin document. A different origin pauses the session. It does not request permanent host permissions to recover access.

## Two storage lifetimes

Saved version 1 guides use `chrome.storage.local` under `handrail-guides-v1`. They persist in the installed extension's browser profile until deleted, removed with extension data or lost with that profile.

The current recording/replay uses `chrome.storage.session` under `handrail-session-v1`. This keeps state across ordinary MV3 service-worker suspension while the browser session remains available. It is not a durable backup of an unsaved recording and does not replace exporting important guides.

Both storage areas restrict direct access to trusted extension contexts. Content scripts receive the current session through explicit messages rather than reading the saved library directly.

## Ordered transitions

Service-worker events can arrive together. One promise queue serializes read/modify/write operations so a click, popup command and navigation do not overwrite each other's progress blindly.

A session is `record` or `replay`, with `active`, `paused` or `complete` status. A recording is saved or discarded rather than marked complete. A replay advances only when a trusted click matches the current recorded target and progress identity. Its last accepted click marks it complete.

## Bind messages to a document

Popup messages must come from this extension's exact `popup.html`. Content messages must match the extension ID, session tab, frame 0, injected document ID, rotating session token and current progress. Page identity is normalized to exact HTTP(S) origin and pathname; credentials are rejected and query/fragment components are omitted.

A genuine click may already have triggered same-origin navigation when its message arrives. The accepted click remains bound to its source document and recorded source pathname, while the current tab must remain on the same origin. Other control messages require the current/source path to agree. Reconnection rotates the document binding and token.

These checks narrow the extension's message surface; they do not certify that an arbitrary website or imported instruction is trustworthy.

## Record a small target identity

The content script handles actual trusted clicks on supported ordinary controls. It excludes form-value controls, editable content, hidden/disabled controls, private markers and controls inside password forms.

It captures the target's pathname, bounded selector, tag, role, normalized label and a default instruction. Selectors prefer a unique escaped ID or selected test-ID attribute, then use a bounded direct-child structural path. They do not record `href` or form-value attributes. Captured IDs and labels can still contain private page context.

## Recheck before highlighting

Replay requires the exact pathname, one selector match, a supported visible target and matching tag/role/name. A mismatch pauses instead of selecting a guessed alternative. A mutation observer plus bounded scheduling responds to DOM, size, scroll and path changes.

The overlay lives in its own shadow root. Its highlight does not intercept clicks on the target; the person still operates the real page. **Show target** scrolls, while pause/resume/stop controls change only the guide session. Removing the session removes its overlay and observers; the installed document listener stays dormant for a later permitted session until the document ends.

## Build products

`scripts/build-extension.mjs` bundles background, content and popup entries as three classic IIFEs, copies the reviewed manifest, popup assets, icons and license into `extension-dist/`, then creates the ZIP from an explicit file list. Vite builds the installation/practice site into `dist/`, including that generated ZIP.

Both output directories and the generated public download are ignored by Git. Source, manifest, icon inputs, build scripts and lockfile reproduce them. The optional icon-generation script needs Chromium; the normal source build does not.

| Module              | Responsibility                                                                        |
| ------------------- | ------------------------------------------------------------------------------------- |
| `src/core.ts`       | Versioned validation, URL/selector rules, sender checks and pure progress transitions |
| `src/background.ts` | Serialized persistence, action commands, injection and navigation handling            |
| `src/content.ts`    | Trusted click capture, target matching and on-page overlay                            |
| `src/popup.ts`      | Local library, recording controls, instruction editing and JSON files                 |
| `src/main.ts`       | Static installation-site interface                                                    |
| `public/practice*`  | No-account demonstration pages for a reproducible first guide                         |
