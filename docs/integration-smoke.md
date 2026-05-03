# Early Integration Smoke Tests

Use these gates before building deeper chat features. They keep us honest against the real extension package and a real Open WebUI server.

## Build Smoke

```bash
npm run smoke:build
```

Expected:

- `dist/manifest.json` exists.
- Manifest V3 permissions are present.
- The side panel path in the manifest exists in `dist`.
- The background service worker path in the manifest exists in `dist`.

## Live Open WebUI Smoke

Run this against a real test account on the target Open WebUI server:

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
npm run smoke:openwebui
```

Optional:

```bash
OPENWEBUI_MODEL_ID='model-id' npm run smoke:openwebui
```

Expected:

- `/api/config` looks like Open WebUI.
- Local sign-in returns a token.
- `/api/v1/auths/` returns the current user.
- `/api/models` returns a model list.
- `/api/v1/models/model?id=...` returns model detail for the selected or first model.
- `/api/v1/chats/` returns recent chat summaries.
- `/api/v1/chats/:id` returns detail for the first recent chat when one exists.

The script does not print the token or password.
It is read-only for chats: it does not create chats, update history, or send prompts.

## Mutating Chat Smoke

Do not add send/stream smoke checks to the default live smoke command. Creating a chat and sending a prompt mutates Open WebUI server history, so that gate should be a separate explicit opt-in command with a clear test title and model selection.

Use a deliberately selected model. The command refuses to run unless `OPENWEBUI_CHAT_MODEL_ID` is set, so it never defaults to the first model on a large server.

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
OPENWEBUI_CHAT_MODEL_ID='fast-short-response-model' \
OPENWEBUI_CHAT_MUTATE=1 \
npm run smoke:chat:send
```

Optional controls:

```bash
OPENWEBUI_CHAT_PROMPT='Reply with exactly: smoke-ok'
OPENWEBUI_CHAT_TIMEOUT_MS=60000
OPENWEBUI_CHAT_MAX_CHARS=2000
```

Expected:

- Local sign-in succeeds.
- The selected model id exists in `/api/models`.
- `/api/chat/completions` returns streamed assistant text.

The command does not print the token or password. It sends one prompt to the selected model and may create server-side activity or history depending on Open WebUI routing, so keep it separate from the read-only smoke.

Known-good result:

- `https://ai.irfansp.dev`
- `openrouter.anthropic/claude-haiku-4.5`
- Direct `/api/chat/completions` streaming returned `open-webui-extension-smoke-ok`.

## Persistent Chat Smoke

Run this before wiring persistence into the side panel. It creates a real chat with the linked user message and assistant placeholder required by Open WebUI history, opens `/api/chat/completions` as the assistant response trigger and possible SSE stream, polls the chat when the stream is empty or delayed, calls `/api/chat/completed`, then refetches the chat and confirms the assistant text persisted.

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
OPENWEBUI_CHAT_MODEL_ID='fast-short-response-model' \
OPENWEBUI_CHAT_PERSIST=1 \
npm run smoke:chat:persist
```

Optional controls:

```bash
OPENWEBUI_CHAT_PROMPT='Reply with exactly: persist-ok'
OPENWEBUI_CHAT_TIMEOUT_MS=60000
OPENWEBUI_CHAT_MAX_CHARS=2000
OPENWEBUI_CHAT_POLL_ATTEMPTS=15
OPENWEBUI_CHAT_POLL_INTERVAL_MS=2000
```

Expected:

- Local sign-in succeeds.
- The selected model id exists in `/api/models`.
- `/api/v1/chats/new` creates a chat.
- `/api/v1/models/model?id=...` returns model detail, or the script falls back to the selected `/api/models` item.
- `/api/chat/completions` triggers the assistant response.
- Direct HTTP stream text or polling `/api/v1/chats/:id` returns assistant text.
- `/api/chat/completed` finalizes the assistant message.
- Refetching `/api/v1/chats/:id` returns persisted assistant content.

The command does not print the token or password. It intentionally creates visible server-side chat history, so keep it separate from read-only and direct streaming smoke checks.

Known-good result:

- `https://ai.irfansp.dev`
- `openrouter.anthropic/claude-haiku-4.5`
- `/api/v1/models/model?id=...` returned `404`, and the script fell back to the selected `/api/models` item.
- The HTTP stream returned no `data:` lines, and polling found `open-webui-extension-persist-ok` after 3 polls.
- `/api/chat/completed` finalized successfully and refetch returned 31 persisted characters.

## Manual Chrome Smoke

1. Run `npm run smoke:build`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Load unpacked extension from `dist`.
5. Click the extension action and confirm the side panel opens.
6. Enter the same server URL, email, and password used in the live smoke.
7. Confirm the ready state appears with the server name and model selector.
8. Inspect extension storage and confirm the token exists but the password is not stored.
9. Close and reopen the side panel.
10. Confirm the extension shows a restoring state instead of flashing the login form while checking the saved session.
11. Confirm the extension restores the saved server/session to the ready state without asking for password again.
12. If the saved session is invalid or expired, confirm the server URL and known email are prefilled and only the password must be re-entered.
13. Click "Forget saved server" from the connection screen and confirm the server URL, token/session, preferences, and active UI state are removed from extension storage.
14. Try an invalid password and confirm an auth error is shown.

## Manual Active Chat Smoke

Run this after persistent chat runtime changes. It intentionally creates visible server-side chat history.

1. Run `npm run smoke:build`.
2. Load or reload the unpacked extension from `dist`.
3. Open the side panel and connect to the target Open WebUI server.
4. Select a fast, short-response model.
5. Send a first message and confirm the chat appears in the Open WebUI website.
6. Send a second follow-up message from the extension.
7. Confirm the second message appears in the same Open WebUI chat, not a separate chat.
8. Switch the model in the extension.
9. Send a third message and confirm it still appears in the same Open WebUI chat.
10. Click "New chat" in the extension.
11. Send another message and confirm this creates a separate Open WebUI chat.

Expected:

- Follow-up sends reuse the active chat id.
- Model switching changes the next completion model but does not reset the active chat.
- Only the explicit "New chat" action starts a separate server-side chat after a chat is active.

## Manual Markdown And Streaming Smoke

Run this after chat rendering changes.

1. Run `npm run smoke:build`.
2. Load or reload the unpacked extension from `dist`.
3. Open the side panel and restore or connect to the target Open WebUI server.
4. Select a fast, short-response model.
5. Send a prompt asking for a heading, bullet list, task checklist, table, inline code, fenced code block, and link.
6. Confirm the assistant response renders markdown formatting instead of raw markdown text.
7. Confirm fenced code has syntax coloring and stays horizontally scrollable when long.
8. Send a prompt to a reasoning model, or load a response with `<think>...</think>`, `<reasoning>...</reasoning>`, or `<details type="reasoning">...</details>`.
9. Confirm thinking content appears in a collapsible reasoning panel while the final answer remains readable.
10. Send a prompt that takes long enough to respond and confirm the assistant text appears incrementally while the request is still running.
11. In browser devtools, confirm a plain send opens `/api/chat/completions` as a streaming request whose request payload does not include `chat_id`, assistant `id`, or `session_id`.
12. Confirm token text appears in multiple visible increments for both SSE `data:` streams and Open WebUI JSONL streams such as `{"done":false,"message":{"content":"..."}}`, not as a single full-answer snapshot after server persistence updates.
13. After completion, confirm the extension persists the conversation with `/api/v1/chats/new` or `POST /api/v1/chats/:id`, calls `/api/chat/completed`, and refetches the chat detail.
14. Send or load assistant text containing raw HTML such as `<strong>bold</strong>` and confirm it is not executed as HTML.
15. Enable web search or a source-returning tool, then ask a current factual question.
16. In browser devtools, confirm this tool/feature send uses the managed Open WebUI path with `chat_id`, assistant `id`, and `session_id`, then recovers through Socket.IO or polling if the HTTP body is quiet.
17. Confirm backed citation markers render as compact clickable source references.
18. Confirm one sources disclosure button appears below the assistant answer.
19. Confirm clicking the sources button shows/hides the source list, and clicking a source reveals URL/snippet details.
20. Without opening the tools picker, ask a model that advertises timestamp or web tools a normal question.
21. Confirm the request does not include `tool_ids` unless you explicitly selected a tool, and that the payload still includes WebUI current-date/current-time prompt variables.

Expected:

- User messages remain plain text.
- Assistant markdown renders headings, lists, task checklists, tables, links, inline code, and syntax-highlighted code blocks.
- Open WebUI reasoning content renders from reasoning tags, reasoning details, or reasoning stream fields into a collapsible panel.
- Backed citation markers render as compact source controls while unbacked `[n]` text stays plain.
- Source lists are collapsed by default and can be expanded without overflowing the side panel.
- Unrecognized raw HTML is not mounted as DOM.
- Streaming state looks intentional while waiting for the first assistant content, and content updates incrementally when available.

### Streaming Diagnostics

When streaming looks delayed or blocked, inspect the side panel DevTools console and filter for `[Open WebUI stream]`. The extension logs safe streaming metadata only: model id, chat id, assistant message id, transport/source, event type, content length, and timing-related poll fields. It must not log tokens, passwords, prompt text, assistant text, or captured page text.

The side panel also exposes an in-memory ring buffer for the current session:

```js
openWebUIStreamDiagnostics.getEntries()
copy(JSON.stringify(openWebUIStreamDiagnostics.getEntries(), null, 2))
```

Use the first `chat.stream.first_text` event to identify which path delivered content first:

- `source: "realtime"` means Socket.IO delivered streamed events.
- `source: "http"` means `/api/chat/completions` returned readable stream events.
- `source: "poll"` means the UI recovered content from persisted chat polling.

For explicit tool/feature sends, persisted chat is the displayed answer source of truth. `chat.stream.tool_text_ignored` means the extension ignored a live HTTP/realtime text preamble for a managed tool run, and `chat.stream.first_text` with `source: "poll"` means the first displayed answer came from persisted chat recovery.

Reasoning panels are progress, not completion. If the visible response only contains Thinking, the extension should keep waiting, poll persisted chat, or eventually show a visible error instead of finalizing that message as a completed answer. This also applies when the thinking snapshot comes from persisted chat polling during a tool run.

On the plain direct-streaming path, `chat.direct.reasoning_only` means the model emitted reasoning but no final answer tokens. The extension preserves that partial model response without showing the generic no-content error.

On the plain direct-streaming path, use `chat.direct.first_text` to confirm the extension rendered the first HTTP chunk before starting the `chat.direct.persist.start` phase. If that direct stream stops producing bytes after partial output, it should fail with a visible error instead of leaving the composer stuck in a sending state.

## Manual Recent Chats Smoke

Run this after loading recent server-side chats into the side panel.

1. Run `npm run smoke:build`.
2. Load or reload the unpacked extension from `dist`.
3. Open the side panel and restore or connect to the target Open WebUI server.
4. Click "Recent chats".
5. Confirm recent server-side chat titles appear.
6. Select one recent chat.
7. Confirm its user and assistant messages load into the side panel.
8. Send a follow-up message.
9. Confirm the Open WebUI website updates the same selected chat instead of creating a separate chat.

Expected:

- Recent chats are fetched from `/api/v1/chats/`.
- Selecting a recent chat fetches `/api/v1/chats/:id`.
- Follow-up sends use the selected chat as the active server-side chat.
