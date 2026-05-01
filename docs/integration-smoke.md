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

Run this before wiring persistence into the side panel. It creates a real chat with the linked user message and assistant placeholder required by Open WebUI history, triggers one assistant response, polls the chat when the HTTP stream is empty, calls `/api/chat/completed`, then refetches the chat and confirms the assistant text persisted.

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
9. Try an invalid password and confirm an auth error is shown.

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
