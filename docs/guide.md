# Record a guide someone can follow

Use this guide with Handrail 0.1.0. You need a desktop browser that supports its Manifest V3 APIs and an ordinary HTTP(S) page. Start on the included practice desk before recording a task with real account or transaction consequences.

## Install a reviewed build

Build from the [README commands](../README.md), or obtain the project's generated extension ZIP from its public installation site when available. Extract a ZIP into a folder you will keep. Open your browser's extensions page, enable **Developer mode**, choose **Load unpacked**, and select the folder containing `manifest.json`.

For a source build, that folder is `extension-dist/`. Chrome uses `chrome://extensions`; Edge uses `edge://extensions`. The project does not publish a Web Store listing or install itself automatically.

Keep the folder in place. After rebuilding source, use the extension page's reload control to load the reviewed new build. Reload the target page as needed so its old content-script instance is replaced.

## Open the practice desk

After a source build, run `npm run dev`. Visit `/practice.html` at the address printed by Vite. The page has a demonstration preferences task and an additional summary page. It does not require an account or send submitted settings to a server.

Invoke **Handrail — your next step** from the browser toolbar while that tab is active. Opening the actual toolbar action grants the temporary page access required by the extension. Opening `popup.html` as an ordinary tab is not the same invocation.

## Record your own clicks

1. Enter a **Guide name** and optional **Description** in the popup.
2. Choose **Start recording**, then close the popup so you can use the page.
3. Click **Open preferences**, **Notifications** and **Save preferences**.
4. Click **Continue to summary**, then **Finish practice** on the next same-origin page.
5. Wait for the captured count to reflect your clicks. Choose **Save recording** from the on-page panel or the popup.

The recorder captures supported buttons, links, summaries and explicit button/link roles. It ignores text inputs, selects, editable content, disabled/hidden controls and supported private markers. It also excludes controls inside password forms. It does not record the value you type into the practice display-name field or its checkbox value.

Recording follows the actions you actually make; those actions can still change the website. Handrail does not undo them or decide whether they are appropriate. Use a nonconsequential task or a demonstration environment for your first guide.

## Pause, save or discard

Choose **Pause** to stop capturing further steps while you prepare the page. **Resume** rechecks page access and reconnects to the session's original tab. A different tab does not take over that session.

**Save recording** requires at least one captured step. It stores a guide in the browser's local extension library and ends the session. **Discard** in the popup asks you to confirm before discarding captured steps; the on-page **Discard recording** control ends that draft directly. Saved guides remain separate.

You can save at most 20 guides with at most 40 steps each. Export an important guide before deleting its local copy.

## Write useful instructions

Select a saved guide and choose **Edit instructions**. Edit its name, description and the instruction for each step. Use concrete actions such as “Open Notifications to choose the reminder settings.”

**Remove step N** removes an unneeded step while retaining at least one. **Save changes** commits your local edit; **Cancel editing** keeps the saved copy. The popup deliberately does not let you hand-edit target selectors, paths or labels. If the website control changed, record the route again.

Stop the guide's current session before editing or deleting its saved copy.

## Follow the guide

Return to the guide's starting page. For the practice desk, open `/practice.html` and reload it to restore its initial state. Invoke Handrail from the toolbar, select the guide and choose **Follow this guide**.

The overlay displays the current instruction and highlights the matching control. Click that control yourself. A click elsewhere does not advance the step. **Show target** scrolls to the control without clicking it. Keep following until the panel reports completion, then choose **Stop guide**.

Pause or stop whenever you need to. Handrail does not click, submit forms or perform tasks in the background.

## Recover from a pause

| Reason                                    | What to do                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Missing target                            | Restore the expected page state or open the saved path, then choose **Resume**.            |
| Ambiguous selector                        | Record the control again so the guide has a unique target.                                 |
| Changed tag, role or label                | Review the site and record the changed route again.                                        |
| Hidden or disabled control                | Make the expected control available, then resume.                                          |
| Wrong path                                | Navigate to the current step's exact saved pathname.                                       |
| Changed origin or page access unavailable | Return to the guide's exact origin, invoke the toolbar action there, then resume.          |
| Another tab is active                     | Return to the session's original tab; saving or stopping remains available from the popup. |
| Original tab closed                       | Save/discard a captured draft, or stop the replay and start the saved guide in a new tab.  |

Temporary access can continue across same-origin navigation while the grant remains valid. A different origin requires a fresh invocation. Query strings and fragments are omitted from page identity, so they cannot distinguish two steps that differ only in those URL parts.

## Share a guide deliberately

Choose **Export JSON** on a saved guide to download a `.handrail.json` file. Review its origin, paths, labels, selectors and instructions before sharing. Even without form values, those fields can reveal private context.

The recipient installs Handrail, chooses **Import guide** and selects the file. Imports are limited to 256 KiB. Importing a guide whose ID already exists creates a new local ID so the old saved copy is retained. The imported guide still needs the matching site, page state and manual toolbar invocation.

## Supported scope

The first version works in a top-level page's ordinary DOM. Browser-restricted pages, frames and controls inside shadow roots are unsupported. It cannot turn a dynamic or redesigned site into a permanently stable guide. Test the actual target workflow after site or browser changes.
