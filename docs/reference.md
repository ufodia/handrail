# Guide, session and message reference

This reference describes Handrail 0.1.0's version 1 files and internal extension contracts. They are source-level APIs, not a published npm package or external messaging API.

The manifest declares Manifest V3 and a minimum Chrome version of 120. The matching APIs and target sites still need verification in the browser build you intend to use; a minimum-version declaration is not a compatibility test.

## Saved guide

| Field         | Type   | Accepted values                                                                        |
| ------------- | ------ | -------------------------------------------------------------------------------------- |
| `version`     | number | Exactly `1`                                                                            |
| `id`          | string | 1–48 letters, digits, `_` or `-`                                                       |
| `name`        | string | 1–80 readable characters; nonempty after trimming                                      |
| `description` | string | 0–400 readable characters                                                              |
| `origin`      | string | Canonical HTTP(S) origin only; no trailing slash, path, query, fragment or credentials |
| `steps`       | array  | 1–40 valid steps with unique step IDs                                                  |

Saved libraries hold at most 20 guides with unique guide IDs. Recording drafts may temporarily contain zero steps; saving/importing requires at least one. Text is trimmed; most ASCII control characters are rejected. Unknown object fields are not preserved by validation.

## Step identity

| Field         | Type   | Accepted values                                                                                                |
| ------------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| `id`          | string | Same 1–48 character ID rule; unique within its guide                                                           |
| `pathname`    | string | 1–1,024 characters; starts with one `/`, without query, fragment, backslash or tab/newline                     |
| `selector`    | string | At most 512 characters in the restricted grammar below                                                         |
| `tag`         | string | Lowercase tag-shaped identifier up to 32 characters; excludes form-value, frame, script, document-root targets |
| `role`        | string | Exactly `button` or `link`                                                                                     |
| `name`        | string | 1–80 readable characters; exact normalized target name                                                         |
| `instruction` | string | 1–240 readable characters                                                                                      |

The selector grammar allows escaped IDs, selected quoted test-ID attributes (`data-testid`, `data-test`, `data-qa`) and direct-child `tag:nth-of-type(N)` segments. A leading `body` is allowed only as the beginning of a longer structural path. Paths contain at most 12 segments. Broad selector lists, value/URL attribute matching and arbitrary selector expressions are rejected.

Runtime matching additionally requires exactly one visible, supported target with the recorded tag, role and name. Schema validation alone does not prove that a target exists or that clicking it is appropriate.

## URL normalization

`normalizePageUrl` accepts URL strings up to 4,096 characters. Origins are limited to 512 characters and pathnames to 1,024. Only HTTP/HTTPS without embedded username/password is supported. The result contains `{origin, pathname, url}`, where `url` is origin plus pathname.

Query strings and fragments are omitted rather than recorded. A guide cannot distinguish two application states by those components alone. Protocol and port remain part of the exact origin.

## JSON import/export

The popup imports one guide JSON object, not an entire library. File size and UTF-8 serialized content are limited to **256 KiB**. Malformed JSON, unsupported schema and bounds fail validation. If an imported guide ID is already saved, the popup assigns a new ID to preserve the existing copy.

Exported files use `.handrail.json` and contain paths, selectors, labels and instructions. No form values are captured, but those fields can still reveal private page context. Review a file before sharing it.

## Session state

`Session` contains `version`, `tabId`, `token`, `mode`, `status`, `origin`, `guide`, `stepIndex`, `reason` and an optional `documentId` binding.

- `mode`: `record` or `replay`.
- `status`: `active`, `paused` or `complete`; recording sessions cannot be complete.
- `stepIndex`: captured step count for recording; next-step index for replay. It stays within guide length.
- `token` and `documentId`: internal document/session bindings, not part of an exported guide.
- `reason`: bounded status text, at most 240 characters.

Saved guides use `chrome.storage.local`; the current session uses `chrome.storage.session`. A browser restart is not a backup of an unsaved recording.

## Popup messages

Messages have `source: 'popup'`. Only this extension's exact popup sender is accepted. Successful responses are `{ok: true, state}`; rejected operations return `{ok: false, error}`.

| Type           | Fields / effect                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET_STATE`    | Returns saved guides, the current session and active-tab eligibility                                         |
| `START_RECORD` | `name`, optional `description`; creates a draft bound to the active permitted tab                            |
| `START_REPLAY` | `guideId`; starts a saved guide on its exact origin                                                          |
| `PAUSE`        | Pauses the current incomplete session                                                                        |
| `RESUME`       | Rechecks the session's original tab, origin, expected path and injection access                              |
| `STOP`         | Boolean `save`; saves a nonempty recording when true, then ends the session                                  |
| `SAVE_GUIDE`   | `guide`; validates and adds/replaces a saved guide; cannot edit the current session's saved copy             |
| `DELETE_GUIDE` | `guideId`; removes a saved guide after the UI's confirmation; cannot delete the current session's saved copy |

`PopupState` contains `guides`, `session` and `activeTab`. Active-tab information exposes normalized origin/path and eligibility feedback rather than storing query or fragment components in guides.

## Content messages

Messages have `source: 'content'` and the current `token`. The service worker also validates extension ID, session tab, frame, document binding and source/current page identity.

| Type             | Required progress data / effect                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| `RECORD_STEP`    | `step`, `expectedCount`; appends a validated step from the bound source page |
| `REPLAY_CLICK`   | `stepIndex`, `stepId`; advances exactly the current step                     |
| `PAUSE_SESSION`  | `stepIndex`, optional `reason`; pauses the current session                   |
| `RESUME_SESSION` | `stepIndex`; rechecks and reconnects a paused session                        |
| `STOP_SESSION`   | `stepIndex`, Boolean `save`; saves/discards as applicable and stops          |

These messages are internal implementation details. The manifest has no `externally_connectable` interface for ordinary websites or other extensions.

## Pure source helpers

| Function                                          | Purpose                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `validateStep`, `validateGuide`, `validateGuides` | Normalize and bound stored/imported data                          |
| `parseGuideJson`                                  | Parse one bounded UTF-8 JSON guide                                |
| `normalizePageUrl`, `isSafeSelector`              | Apply supported page identity and selector grammar                |
| `validateSession`                                 | Check progress, mode/status and guide consistency                 |
| `isPopupSender`, `isContentSender`                | Check internal sender/document identity                           |
| `appendRecordedStep`                              | Append only to the active expected recording count                |
| `advanceReplay`                                   | Advance only an active matching step; mark the last step complete |
| `createId`                                        | Create a random UUID used for local IDs and session bindings      |

Helpers throw readable errors for invalid data or transitions. See [architecture](architecture.md) for how these checks join the actual browser lifecycle.
