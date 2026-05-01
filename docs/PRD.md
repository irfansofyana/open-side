# Open WebUI Chrome Extension PRD

## Summary

Build a Chrome Manifest V3 extension that brings an Open WebUI chat client into Chrome's side panel. The MVP should feel like a Gemini-style browser companion while using the user's own Open WebUI server for authentication, models, chats, history, and server-side tools.

The extension is not a web wrapper. It is a native extension UI that talks to Open WebUI APIs.

## Goals

- Let users connect to a self-hosted Open WebUI server from the Chrome side panel.
- Support local Open WebUI email/password login.
- Let users chat with configured Open WebUI models without opening the Open WebUI website.
- Preserve server-side chat history so conversations remain available in Open WebUI.
- Keep follow-up messages in the active server-side chat until the user explicitly starts a new chat.
- Support streaming responses by default.
- Support model switching before or during a chat without implicitly creating a new chat.
- Support Open WebUI server-side tools, including custom tools, through the same server-side execution path Open WebUI uses.
- Show recent server-side chats in a Gemini-like top menu so users can quickly resume past conversations.
- Let users explicitly add context from currently open browser tabs to a chat.
- Deliver a narrow-first Gemini-like side panel experience with Open WebUI-style model and tool controls.

## Non-Goals For MVP

- Full Open WebUI admin console inside the extension.
- OAuth, SSO, LDAP, or reverse-proxy auth flows.
- Multiple saved servers in the visible UI.
- Local execution of Open WebUI tools inside the browser extension.
- File upload, knowledge base picker, prompt library, skills picker, voice mode, image generation UI, channels, folders, memories, automations, or calendar unless they are naturally exposed by selected server-side tools.
- Firefox support.
- General Chromium support guarantees outside Chrome.
- A pixel-perfect clone of Open WebUI or Gemini.

## Target User

A user who already runs an Open WebUI server and wants quick browser-side access to their configured models and tools while browsing. The user expects the extension to behave like a real Open WebUI client, not a disconnected chat toy.

## MVP Platform

- Browser: Google Chrome.
- Extension model: Manifest V3.
- Primary UI: Chrome Side Panel.
- Frontend stack: Vite, React, TypeScript.
- Storage: `chrome.storage.local`.
- Server count: one configured server in the MVP UI, with internals designed around a `serverId` so multi-server support can be added later.
- Target Open WebUI compatibility: current stable Open WebUI API behavior at implementation time. API details must be verified against a running target server before finalizing implementation.

## Product Decisions

### Authentication

The MVP uses Open WebUI local email/password authentication.

Flow:

1. User enters Open WebUI server URL.
2. User enters email or username and password.
3. Extension calls the Open WebUI sign-in endpoint.
4. Extension stores the returned token/session metadata and server URL.
5. Extension clears the password immediately after login.
6. Extension uses the stored token for authenticated API requests.

The extension must not store the user's password.

If the token expires or becomes invalid, the extension asks the user to log in again.

### Chat History

Chat history must be server-side. Users should be able to start or continue a chat in the extension and see that conversation from the Open WebUI website.

The side panel should keep one active chat session. Sending another message continues that active server-side chat. A new server-side chat is created only when there is no active chat yet or when the user explicitly chooses a visible "New chat" action.

The extension should follow Open WebUI's UI-compatible chat lifecycle:

- create or load server-side chats
- fetch recent server-side chats for the top menu
- include the active `chat_id` when generating responses
- stream responses
- finalize completed chats so server-side history and post-processing remain consistent

If the server-side chat API shape differs across Open WebUI versions, the extension should fail clearly rather than silently storing disconnected local-only chats.

The MVP must include a Gemini-like recent chats menu. The menu should open from the top actions area, show the most recent server-side chats with truncated titles, highlight the active chat, and provide a "More" entry for a fuller history view. Selecting a recent chat loads that server-side conversation into the side panel.

### Streaming

Streaming is required for MVP. It is the default response mode.

A non-streaming fallback may exist for compatibility, but the normal user experience should show incremental assistant output.

### Models

The extension fetches models from the connected Open WebUI server and lets the user switch models before or during a chat.

Switching the selected model during an active chat changes the model used for the next send, but it must not reset the conversation or create a separate server-side chat by itself.

The selected model should persist per server. If possible, selected model should also persist per chat in whatever shape Open WebUI expects.

### Tools

All tools in MVP means all relevant tools available on the connected Open WebUI server, executed server-side.

The extension acts only as UI and request coordinator:

- discover available tools and feature toggles
- render a tools menu similar to Open WebUI's composer tools menu
- let users enable or disable tools per chat
- send selected tool IDs and feature flags in the chat request
- stream and render the server's result

The extension must not execute arbitrary Open WebUI tools locally.

Tool support includes:

- built-in Open WebUI features such as web search and code interpreter when available
- custom server-side tools when the server exposes them to the user/model

Implementation must treat tool availability as server-controlled. If a tool is disabled by server config, user permissions, or model capability, the extension should not pretend it is available.

MVP rendering for tool output includes plain text, markdown, code blocks, links, and structured status/progress messages returned through the normal chat stream. Rich interactive outputs such as live HTML embeds, custom artifact viewers, audio, video, or advanced diagram renderers are follow-up work unless they arrive as ordinary markdown that can be rendered safely.

### Browser Tab Context

The extension supports explicit selected-tab sharing per chat.

The composer should include an "Add tabs" control near the tools/composer controls. Opening it shows a Gemini-like picker of currently open browser tabs, including favicon, title, URL/origin where useful, and an indicator for the current tab. The user can select one or more tabs to attach as context.

When a tab is selected, the extension captures what is available:

- tab title
- tab URL
- selected text
- readable page text

MVP reliability rule: title and URL should be available for listed tabs. Selected text and readable page text are required when Chrome grants page access, with the active/current tab as the reliable full-context case. For non-active selected tabs where readable extraction is blocked, the extension should still attach title and URL, mark page text as unavailable, and let the user continue.

For MVP, selected-tab context is injected into the outgoing prompt as visible context blocks, one block per selected tab.

Long-term, long tab context can be upgraded to a file or RAG attachment flow. That is not required for MVP.

The user must be able to see when tab context is being shared. The composer should show a "Sharing N tabs" state with selected tab chips or icons. The extension should not automatically attach page content without explicit user action.

Some pages cannot be read by extensions, such as Chrome internal pages, extension pages, some PDFs, and restricted browser surfaces. The extension should show a clear unavailable state for those pages.

Readable page text should be capped before prompt injection. The MVP cap is 20,000 characters of cleaned readable text per selected tab, with a visible truncation note when content is shortened.

### Visual Experience

The extension uses a Gemini-like side panel layout with Open WebUI controls.

Core layout:

- dark narrow-first panel
- welcome state with greeting and prompt suggestions
- bottom composer
- model selector inside or near composer
- tools menu near composer
- add-tabs control near composer for selecting open browser tabs as context
- top menu with recent chats, "More" history entry, settings, logout, and utility actions

The UI should feel natural at common side panel widths around 320-480px. It may adapt to wider layouts later, but the MVP must not depend on a full desktop-width sidebar.

## Core User Journeys

### First-Time Connect

1. User opens the extension side panel.
2. User sees a connection screen.
3. User enters server URL.
4. User enters email or username and password.
5. Extension validates the server and credentials.
6. User lands on the chat welcome screen.

Success criteria:

- successful login stores token and server URL
- password is not persisted
- errors identify connection, auth, or server compatibility problems clearly

### Start A New Chat

1. User opens the side panel.
2. If another chat is active, user clicks "New chat".
3. User chooses a model or accepts the default.
4. User optionally toggles tools.
5. User optionally adds context from open browser tabs.
6. User sends a prompt.
7. Assistant response streams into the chat.
8. Chat is saved server-side.

Success criteria:

- new chat creation is an explicit user action after a chat is active
- response streams visibly
- active model is clear
- enabled tools are clear
- chat appears in Open WebUI server history

### Continue Existing Chat

1. User opens the top menu.
2. User sees recent server-side chats.
3. User selects a recent chat or opens "More" for a fuller history view.
4. User selects a server-side chat.
5. Extension loads its messages.
6. User continues the conversation.

Success criteria:

- recent chats appear in a compact Gemini-like menu
- active chat is visually distinguishable
- long chat titles are truncated cleanly
- "More" opens a fuller history view
- loaded messages match server history
- continuing the chat updates the same server-side conversation
- switching the model before a follow-up keeps the same active server-side conversation

### Open Full History

1. User opens the top menu.
2. User selects "More".
3. Extension shows a fuller list of server-side chats.
4. User selects a chat.
5. Extension loads its messages.
6. User continues the conversation.

Success criteria:

- fuller history is loaded from the Open WebUI server
- fuller history supports loading more chats if the server has additional pages or batches
- loaded messages match server history
- continuing the chat updates the same server-side conversation

### Add Open Tabs As Context

1. User opens side panel.
2. User clicks the "Add tabs" control near the composer/tools area.
3. Extension shows a Gemini-like list of currently open browser tabs.
4. User selects one or more tabs.
5. Extension captures available context for selected tabs.
6. Composer indicates "Sharing N tabs" and shows selected tab chips or icons.
7. User sends a prompt.
8. Selected tab context is included in the prompt sent to Open WebUI.

Success criteria:

- user has explicit control over sharing
- open tabs are listed with useful titles and favicons
- the current tab is clearly labeled
- multiple tabs can be selected
- restricted pages show a clear unavailable state
- shared context is visible or inspectable before send

### Use Tools

1. User opens the tools menu.
2. User sees server-available tools and built-in feature toggles.
3. User enables tools for the chat.
4. User sends a prompt.
5. Open WebUI executes tools server-side where appropriate.
6. Extension renders the response and any server-provided tool output.

Success criteria:

- tools reflect server/model/user availability
- selected tools are included in chat requests
- no tools execute locally inside the extension

## Data Model

The extension should keep local state minimal and server-scoped.

Suggested local records:

- `serversById`
  - `id`
  - `baseUrl`
  - `displayName`
  - `createdAt`
  - `lastConnectedAt`
- `sessionsByServerId`
  - `serverId`
  - `token`
  - `tokenType`
  - `expiresAt`
  - `user`
- `preferencesByServerId`
  - `serverId`
  - `selectedModelId`
  - `enabledToolIds`
  - `enabledFeatures`
- `uiState`
  - `activeServerId`
  - `activeChatId`

Do not store passwords.

## API Assumptions

The MVP assumes the connected Open WebUI server supports API access for:

- local sign-in
- current user/session validation
- model listing
- chat listing and chat detail
- chat creation/update
- streaming chat completions
- chat completion finalization
- tool or feature discovery

Known Open WebUI endpoints and payloads must be verified during implementation against the target server version. Where Open WebUI has version differences or undocumented behavior, the implementation should isolate API calls behind a dedicated client module.

## Permissions

Expected Chrome permissions:

- `sidePanel`
- `storage`
- `activeTab`
- `scripting`
- `tabs`

Host permissions should be minimized. The MVP needs `tabs` to list open browser tabs, and `activeTab` plus `scripting` for explicit readable context capture where Chrome allows it. The extension should not request broad persistent access to all page contents for MVP.

The extension also needs network access to the configured Open WebUI server. The MVP should request optional host permission for the specific server origin after the user enters the server URL. It should not request broad persistent `<all_urls>` access for server communication.

## Error Handling

The extension should distinguish:

- invalid server URL
- server unreachable
- Open WebUI API not found or incompatible
- invalid credentials
- expired token
- missing model access
- tool unavailable
- selected tab context unavailable
- streaming interrupted
- server-side chat save/finalization failure

Errors should be visible in the UI and actionable. For example, expired token should offer login, while selected tab context unavailable should allow normal chat without that tab's readable text.

## Privacy And Security

- Never persist user password.
- Treat JWT/session token as sensitive.
- Do not send browser tab context unless the user explicitly selects tabs to share.
- Make selected-tab sharing state visible in the composer.
- Avoid broad host permissions for page contents if `activeTab` and explicit user selection are sufficient.
- Do not run server-defined tools locally.
- Do not log tokens, passwords, or captured page text.

## Acceptance Criteria

The MVP is complete when:

- User can install the unpacked Chrome extension.
- User can open the Chrome side panel.
- User can connect to one Open WebUI server with local email/password.
- Password is not stored after login.
- User can see available models from the server.
- User can select a model.
- User can start a new server-side chat.
- User can explicitly start a new chat from an active conversation.
- User can stream a response from the selected model.
- Follow-up messages continue the same active server-side chat unless the user starts a new chat.
- User can switch models within an active chat and send the next message to the newly selected model without creating a separate chat.
- User can open a Gemini-like top menu and see recent server-side chats.
- User can select a recent chat and continue it.
- User can open "More" from recent chats to view fuller server-side chat history.
- User can open a tools menu and enable server-side tools available to the selected user/model.
- Enabled tools are sent to Open WebUI and executed server-side when the server/model chooses to use them.
- User can open an "Add tabs" picker from the composer/tools area.
- User can see currently open browser tabs with favicons and titles.
- User can explicitly select one or more tabs to share.
- Shared selected-tab context includes title and URL for selected tabs.
- Shared selected-tab context includes selected text and readable page text when Chrome grants page access.
- Readable page text is capped at 20,000 characters per selected tab and visibly marked if truncated.
- Restricted pages fail gracefully for context capture.
- Rich markdown and code blocks render in chat.
- Rich interactive tool artifacts are not required beyond safe markdown/text rendering.
- User can log out and clear local session data.

## Implementation Risks To Resolve

- Which exact Open WebUI endpoints should be used for chat listing, chat creation, chat updates, and tool discovery for the target server version?
- Does the target Open WebUI server expose custom tools through a stable public endpoint, or do we need to mirror the web frontend's internal API calls?
- What exact payload shape does the target server expect for selected custom tools versus built-in feature toggles?
- Does optional host permission for the user-entered Open WebUI origin cover all required API calls across local and remote server setups?
- Which pages produce unusable readable text extraction and need special empty-state handling?
- Does Chrome grant enough access to capture readable text from non-active selected tabs on the user's target sites, or should a later version request optional per-site host permissions for deeper multi-tab extraction?

## Recommended First Implementation Slice

Build the product in this order:

1. Extension shell: Vite, React, TypeScript, Manifest V3, side panel.
2. Storage and connection screen.
3. Open WebUI API client with sign-in and token handling.
4. Model loading and model selector.
5. Minimal server-side new chat and streaming completion.
6. Gemini-like top menu with recent server-side chats.
7. Fuller server-side chat history and continue flow.
8. Tools discovery and per-chat tool selection.
9. Open-tabs picker, selected-tab context capture, and prompt injection.
10. UI polish toward Gemini-style panel with Open WebUI controls.
11. Error handling, compatibility checks, and manual end-to-end testing.
