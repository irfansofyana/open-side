# OpenSide

OpenSide is a Chrome Manifest V3 side-panel extension for Open WebUI. It is a native extension UI, not an iframe wrapper, that connects to your own Open WebUI server for authentication, models, chats, history, and server-side tools.

The goal is a browser companion experience similar to a narrow chat side panel, while preserving Open WebUI compatibility and server-side chat history.

## What Works

- Connect to a self-hosted Open WebUI server with local email/password auth.
- Store the server URL and session token in `chrome.storage.local`.
- Restore a saved session when reopening the side panel.
- Forget the saved server/session from the UI.
- Fetch Open WebUI models and persist the selected model per server.
- Start new chats and continue the active server-side chat.
- Load recent server-side chats and resume them in the side panel.
- Stream assistant responses from Open WebUI.
- Persist completed chats back to Open WebUI history.
- Render assistant markdown, code blocks, tables, task lists, links, reasoning blocks, and citations.
- Add explicit current/open-tab context into the outgoing prompt.
- Discover Open WebUI tools, functions, and built-in feature toggles.
- Route tool, feature, filter, and native function-calling model requests through the managed Open WebUI chat path.
- Recover managed chat output through Socket.IO and persisted-chat polling when the HTTP stream is quiet or left open.

## Architecture

The extension is split into a small Chrome shell, a React side panel, and compatibility-focused runtime modules:

- `src/sidepanel/` contains the React app, chat UI, model/tools controls, markdown rendering, and side-panel styles.
- `src/background/` contains the Manifest V3 service worker that opens the side panel.
- `src/content/` contains page-context extraction used after explicit tab sharing.
- `src/lib/openwebui/` contains the Open WebUI API client, request builders, stream parser, realtime parser, types, and citation normalization.
- `src/lib/runtime/` contains chat orchestration, connection restore/login logic, tab prompt injection, tools discovery, and streaming diagnostics.
- `src/lib/chrome/` contains typed wrappers for Chrome storage, tabs, and permissions.

The chat runtime uses two response paths:

- Plain chat uses direct HTTP streaming first, then persists the final user/assistant pair into Open WebUI history.
- Tool, feature, filter, pipe, and native function-calling model flows use the managed Open WebUI path with `chat_id`, assistant message id, `session_id`, Socket.IO events, and persisted-chat polling recovery.

Native function-calling models are treated as managed even when no tool is selected, because Open WebUI can change streaming behavior based only on the model's `params.function_calling: "native"` metadata.

## Requirements

- Node.js 20 or newer is recommended.
- npm.
- Google Chrome with extension Developer Mode enabled.
- A reachable Open WebUI server with local email/password sign-in.

## Setup

```bash
npm install
```

## Development

Run Vite for local side-panel development:

```bash
npm run dev
```

Build the extension package:

```bash
npm run build
```

Run the test suite:

```bash
npm test
```

Run the TypeScript check:

```bash
npm run lint
```

Verify the built extension package shape:

```bash
npm run smoke:build
```

## Loading In Chrome

1. Run `npm run smoke:build`.
2. Open `chrome://extensions`.
3. Enable Developer Mode.
4. Click "Load unpacked".
5. Select the generated `dist` directory.
6. Click the OpenSide extension action to open the side panel.
7. Enter your Open WebUI server URL, email or username, and password.

The extension stores the session token after login, but it does not store the password.

## Live Smoke Tests

Read-only Open WebUI compatibility smoke:

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
npm run smoke:openwebui
```

Mutating direct chat smoke:

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
OPENWEBUI_CHAT_MODEL_ID='model-id' \
OPENWEBUI_CHAT_MUTATE=1 \
npm run smoke:chat:send
```

Mutating persisted chat smoke:

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
OPENWEBUI_CHAT_MODEL_ID='model-id' \
OPENWEBUI_CHAT_PERSIST=1 \
npm run smoke:chat:persist
```

Tool discovery smoke:

```bash
OPENWEBUI_URL=http://localhost:3000 \
OPENWEBUI_EMAIL=user@example.com \
OPENWEBUI_PASSWORD='password' \
npm run smoke:tools
```

The mutating smoke commands create visible activity in Open WebUI server history. Use a test account or disposable chat history when running them.

## Streaming Diagnostics

When a response looks delayed or stuck, open the side-panel DevTools console and filter for:

```text
[Open WebUI stream]
```

The runtime also exposes a session-local diagnostics buffer:

```js
openWebUIStreamDiagnostics.getEntries()
copy(JSON.stringify(openWebUIStreamDiagnostics.getEntries(), null, 2))
```

Diagnostics are designed to avoid secrets and content. They log metadata such as source (`http`, `realtime`, or `poll`), stream event type, ids, content lengths, and polling state.

## Current Limitations

- Only one saved server is exposed in the MVP UI.
- Auth support is local Open WebUI email/password only.
- Rich Open WebUI artifacts, file upload, voice, image generation UI, memories, folders, and full history pagination are not implemented yet.
- Browser tab readable text depends on Chrome permissions and page restrictions.
- The extension targets Chrome Manifest V3; Firefox and broader Chromium compatibility are not guaranteed.

## Documentation

More implementation notes live in:

- `docs/PRD.md`
- `docs/TECHNICAL_DESIGN.md`
- `docs/integration-smoke.md`
