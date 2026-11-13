# A guide is local, but still worth reviewing

Handrail 0.1.0 stores saved guides in the installed extension's local browser profile. Its application code does not send guide contents to an account service, analytics endpoint or remote database. Import/export is a deliberate local-file operation.

## What a recorded step contains

A step stores the exact pathname, a bounded element selector, target tag/role/name and your instruction. The guide stores its name, description and exact site origin. Queries, fragments and URL credentials are not recorded as page identity.

The recorder ignores text inputs, selects, editable controls and their values. It excludes hidden/disabled controls, controls inside password forms, and supported private markers (`data-private`, `data-sensitive`, `data-handrail-private`) on relevant ancestors or contents.

These exclusions do not make every captured field public. A button label may contain a person's name, an element ID may encode a record identifier, and a page path may reveal an internal resource. Your own instructions can disclose private context too. **Review exported JSON before sharing it.**

Handrail does not record screenshots, video, audio or the entire page as a guide. It reads target DOM properties needed to identify supported controls while a session is active.

## Why the extension asks for access

| Permission  | What it enables                                                         |
| ----------- | ----------------------------------------------------------------------- |
| `activeTab` | Temporary access after you invoke Handrail on the active page           |
| `scripting` | Inject the local guide content script into the permitted top-level page |
| `storage`   | Save the local guide library and current session state                  |

The manifest does not request permanent access to all websites. The active-tab grant can continue on same-origin navigation and is revoked when leaving that origin or closing the tab. Access to restricted browser pages is unavailable. Reopen the toolbar action on the intended site when a fresh grant is needed.

## Storage and deletion

Saved guides use `chrome.storage.local`; the application does not use browser-sync guide storage. The active session/draft uses `chrome.storage.session`, which supports service-worker restarts within the browser session and is not a durable draft backup.

Export important guides to keep your own backup. **Delete guide** followed by **Delete saved guide** removes that saved browser copy; exported files remain where you saved them. Removing the extension or losing its browser profile can remove local guides. Rebuilding source does not migrate a browser library automatically.

## Following a guide

An imported guide can tell you to perform real website actions. Handrail checks whether a target matches the recorded identity; it does not judge an instruction's intent, verify a site's trustworthiness or undo your clicks. Review instructions and keep control of the actual task.

The overlay never clicks or fills a form for you. **Show target** scrolls to a target; a real user click advances a step. The application does not protect you from consequences you choose on the underlying website.

## The public installation site

The project site serves static assets, a generated extension ZIP and demonstration practice pages. The practice pages require no account and send no preferences to an application server. Ordinary hosting/browser access logs are outside this application-level description. Source and support links open GitHub or Buy Me a Coffee under those services' own policies.

Use synthetic examples when reporting a public issue. Sensitive findings follow [the security policy](../SECURITY.md).
