# UI Improvements Todo

> Deferred polish list. Do these after the core Open WebUI integration paths are working in real manual use.

## Guardrail

- [ ] Keep integration behavior stable before visual polish: saved session restore, persistent chat, active-chat continuation, model switching, and manual Chrome smoke must stay green.
- [ ] For every visual pass, run `npm run smoke:build` and manually inspect the side panel at narrow widths around 320-480px.
- [ ] Do not add marketing/landing-page UI. The side panel should open directly into the usable chat experience.

## Side Panel Layout

- [ ] Replace the current prototype panels with a denser Gemini-like side panel layout.
- [ ] Move model selection and New chat into a compact top/composer control area.
- [ ] Keep the composer pinned and comfortable at common side-panel heights.
- [ ] Ensure the message list scrolls naturally without hiding the composer.
- [ ] Add empty/welcome state prompt suggestions only when no chat is active.

## Chat Experience

- [ ] Render assistant markdown instead of plain text.
- [ ] Add code block styling with copy affordance.
- [ ] Add clear streaming state for the active assistant message.
- [ ] Distinguish polling fallback from active token streaming only if useful for debugging or user trust.
- [ ] Improve message spacing, typography, and contrast for long conversations.
- [ ] Add timestamps or subtle metadata only if it helps scanability.

## Saved Session And Connection UX

- [ ] Polish the "Restoring session" state so it feels intentional, not like a blank loading screen.
- [ ] Make re-login state clear when the token expired while preserving saved server URL and email.
- [ ] Place "Forget saved server" in a settings/account area once the top menu exists.
- [ ] Add logout once session clearing has a dedicated UI path.

## Chat Navigation

- [ ] Add a top menu for recent chats.
- [ ] Highlight the active chat in the recent chat list.
- [ ] Add "More" history view with fuller server-side history.
- [ ] Load selected chat messages into the side panel with an obvious active state.
- [ ] Make New chat visually explicit but not dominant over continuing the current chat.

## Model And Tools Controls

- [ ] Improve model selector for long model names.
- [ ] Keep model switching clear inside the same active chat session.
- [ ] Add tools menu with server-provided tools and built-in feature toggles.
- [ ] Show selected tools/features near the composer without crowding it.

## Browser Tab Context

- [ ] Add "Add tabs" control near composer/tools.
- [ ] Show selected-tab chips or compact indicators.
- [ ] Clearly mark restricted tabs or unavailable readable text.
- [ ] Show visible context-sharing state before send.

## Accessibility And Responsiveness

- [ ] Verify keyboard navigation for connect, model selector, New chat, composer, menus, and history.
- [ ] Add focus states that are visible in dark mode.
- [ ] Check button and control labels with Testing Library queries.
- [ ] Ensure text never overflows buttons, controls, or message cards at 320px width.
- [ ] Avoid layout shift when messages stream or status text changes.

## Manual Visual Checks

- [ ] Capture screenshots for: first connect, restoring session, ready state, active chat, streaming, expired session, recent chats, full history, tools menu, and tab picker.
- [ ] Compare narrow side-panel width and wider desktop width.
- [ ] Confirm Open WebUI website state matches extension state after UI changes.
