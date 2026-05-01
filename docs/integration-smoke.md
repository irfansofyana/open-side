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
