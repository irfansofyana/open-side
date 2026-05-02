# UI Improvements Todo

> Deferred polish list. Do these after the core Open WebUI integration paths are working in real manual use.

## Guardrail

- [ ] Keep integration behavior stable before visual polish: saved session restore, persistent chat, active-chat continuation, model switching, and manual Chrome smoke must stay green.
- [ ] For every visual pass, run `npm run smoke:build` and manually inspect the side panel at narrow widths around 320-480px.
- [ ] Do not add marketing/landing-page UI. The side panel should open directly into the usable chat experience.

## Side Panel Layout

- [x] Replace the current prototype panels with a denser Gemini-like side panel layout.
- [x] Move model selection and New chat into a compact chat control area.
- [x] Keep the composer pinned and comfortable at common side-panel heights.
- [x] Ensure the message list scrolls naturally without hiding the composer.
- [x] Add empty/welcome state prompt suggestions only when no chat is active.

## Chat Experience

- [x] Render assistant markdown instead of plain text.
- [ ] Add code block styling with copy affordance.
- [x] Add syntax-highlighted code block styling.
- [x] Render GFM task checklists and tables.
- [x] Render Open WebUI reasoning/thinking blocks.
- [x] Render Open WebUI tool-call detail blocks with arguments and results.
- [x] Render backed Open WebUI citation markers as clickable source references.
- [x] Add clear streaming state for the active assistant message.
- [x] Stream persisted polling deltas when direct HTTP stream content is empty.
- [ ] Distinguish polling fallback from active token streaming in the UI only if useful for debugging or user trust.
- [x] Show the model name used for assistant responses instead of a generic assistant label.
- [x] Improve message spacing, typography, and contrast for long conversations.
- [ ] Add timestamps or subtle metadata only if it helps scanability.

## Saved Session And Connection UX

- [x] Polish the "Restoring session" state so it feels intentional, not like a blank loading screen.
- [ ] Make re-login state clear when the token expired while preserving saved server URL and email.
- [ ] Place "Forget saved server" in a settings/account area once the top menu exists.
- [ ] Add logout once session clearing has a dedicated UI path.

## Chat Navigation

- [x] Add a top menu for recent chats.
- [x] Highlight the active chat in the recent chat list.
- [ ] Add "More" history view with fuller server-side history.
- [ ] Load selected chat messages into the side panel with an obvious active state.
- [x] Make New chat visually explicit but not dominant over continuing the current chat.

## Model And Tools Controls

- [x] Improve model selector for long model names.
- [x] Keep model switching clear inside the same active chat session.
- [x] Add tools menu with server-provided tools and built-in feature toggles.
- [x] Show selected tools/features near the composer without crowding it.
- [x] Add live smoke script for Open WebUI tools/functions discovery.
- [x] Include Web Search from authenticated Open WebUI config when `features.enable_web_search` is enabled.
- [ ] Manually verify a selected server tool executes from the extension against the target Open WebUI server.

## Browser Tab Context

- [x] Treat browser tab context as the next feature slice before server tools.
- [x] Add "Add tabs" control near composer/tools.
- [x] Auto-attach the current active tab when the user clicks "Add tabs".
- [x] Show selected-tab chips or compact indicators.
- [x] Clearly mark restricted tabs or unavailable readable text.
- [x] Show visible context-sharing state before send.
- [ ] Consider an explicit "Allow all sites" onboarding/settings option for users who prefer one broad Chrome permission prompt over per-origin prompts.

## Accessibility And Responsiveness

- [ ] Verify keyboard navigation for connect, model selector, New chat, composer, menus, and history.
- [ ] Add focus states that are visible in dark mode.
- [x] Check button and control labels with Testing Library queries.
- [x] Ensure text never overflows buttons, controls, or message cards at 320px width.
- [x] Avoid layout shift when messages stream or status text changes.

## Manual Visual Checks

- [ ] Capture screenshots for: first connect, restoring session, ready state, active chat, streaming, expired session, recent chats, full history, tools menu, and tab picker.
- [ ] Compare narrow side-panel width and wider desktop width.
- [ ] Confirm Open WebUI website state matches extension state after UI changes.
