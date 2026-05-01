# OpenWebUI Chat Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-side chat listing, chat loading, new chat creation, Open WebUI-shaped completion payloads, direct streaming, completion finalization, polling recovery, and recent/full history support.

**Architecture:** Chat behavior lives below the UI in `src/lib/openwebui` and `src/lib/runtime`. The API client owns endpoints, `requestBuilders.ts` owns Open WebUI-compatible payload shape, `stream.ts` owns SSE parsing, and `chatRuntime.ts` coordinates state updates without making the side panel understand protocol details.

**Tech Stack:** TypeScript, Vitest, Fetch streaming, Chrome extension side panel, Open WebUI REST APIs.

---

## Source Documents

- [PRD](../../PRD.md)
- [Technical Design](../../TECHNICAL_DESIGN.md)

## File Structure

- Modify: `src/lib/openwebui/types.ts` - chat, message tree, payload, stream, and error types.
- Modify: `src/lib/openwebui/client.ts` - chat list, detail, create, update, completion, completed, and model detail endpoints.
- Create: `src/lib/openwebui/requestBuilders.ts` - Open WebUI-compatible chat completion payload builder.
- Create: `src/lib/openwebui/requestBuilders.test.ts` - payload compatibility tests.
- Create: `src/lib/openwebui/stream.ts` - direct SSE parser and stream helpers.
- Create: `src/lib/openwebui/stream.test.ts` - streaming parser tests.
- Create: `src/lib/runtime/chatRuntime.ts` - new chat, continue chat, send, finalize, recover, and history orchestration.
- Create: `src/lib/runtime/chatRuntime.test.ts` - runtime tests with mocked client.
- Create: `scripts/openwebui-poc.ts` - command-line proof harness for gates 1-12 from the technical design.
- Modify: `package.json` - add `poc:openwebui` script.

## Task 1: Chat Types

**Files:**
- Modify: `src/lib/openwebui/types.ts`

- [ ] **Step 1: Add chat and payload types**

Append this to `src/lib/openwebui/types.ts`:

```ts
export type ChatMessageRole = "system" | "user" | "assistant" | "tool";

export type ChatMessageNode = {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: ChatMessageRole;
  content: string;
  model?: string;
  createdAt?: number;
  done?: boolean;
  error?: string;
  files?: unknown[];
  sources?: unknown[];
  usage?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type ChatTree = {
  id: string;
  title: string;
  messages: Record<string, ChatMessageNode>;
  currentId?: string;
  createdAt?: number;
  updatedAt?: number;
  pinned?: boolean;
  raw?: Record<string, unknown>;
};

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt?: number;
  pinned?: boolean;
  raw?: Record<string, unknown>;
};

export type ChatCompletionFeatures = FeatureFlags;

export type ChatCompletionRequest = {
  stream: true;
  model: string;
  messages: Array<Record<string, unknown>>;
  chat_id?: string;
  session_id?: string;
  id?: string;
  parent_id?: string | null;
  user_message?: Record<string, unknown>;
  model_item?: Record<string, unknown>;
  tool_ids?: string[];
  filter_ids?: string[];
  features: ChatCompletionFeatures;
  params: Record<string, unknown>;
  variables: Record<string, unknown>;
  metadata: {
    variables: Record<string, unknown>;
  };
  stream_options: {
    include_usage: true;
  };
  background_tasks: Record<string, unknown>;
  tool_servers: Array<Record<string, unknown>>;
};

export type BuildCompletionPayloadInput = {
  modelId: string;
  messages: Array<Record<string, unknown>>;
  chatId?: string;
  sessionId?: string;
  assistantMessageId?: string;
  parentId?: string | null;
  userMessage?: Record<string, unknown>;
  modelItem?: Record<string, unknown>;
  toolIds?: string[];
  filterIds?: string[];
  features?: Partial<ChatCompletionFeatures>;
  params?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  backgroundTasks?: Record<string, unknown>;
  toolServers?: Array<Record<string, unknown>>;
  isPipeModel?: boolean;
};

export type StreamEvent =
  | { type: "content"; content: string }
  | { type: "status"; status: string; raw?: unknown }
  | { type: "usage"; usage: Record<string, unknown> }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "done" };
```

- [ ] **Step 2: Run type check**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/openwebui/types.ts
git commit -m "feat: add chat runtime types"
```

## Task 2: Completion Payload Builder

**Files:**
- Create: `src/lib/openwebui/requestBuilders.ts`
- Create: `src/lib/openwebui/requestBuilders.test.ts`

- [ ] **Step 1: Write payload tests**

Create `src/lib/openwebui/requestBuilders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCompletionPayload } from "./requestBuilders";

describe("buildCompletionPayload", () => {
  it("builds the Open WebUI web-client shaped request", () => {
    const payload = buildCompletionPayload({
      modelId: "llama",
      chatId: "chat-1",
      sessionId: "session-1",
      assistantMessageId: "assistant-1",
      parentId: "user-1",
      messages: [{ role: "user", content: "hello" }],
      userMessage: { id: "user-2", role: "user", content: "hello" },
      modelItem: { id: "llama", meta: { toolIds: ["search"] } },
      toolIds: ["search"],
      filterIds: ["filter-1"],
      features: { web_search: true }
    });

    expect(payload).toMatchObject({
      stream: true,
      model: "llama",
      chat_id: "chat-1",
      session_id: "session-1",
      id: "assistant-1",
      parent_id: "user-1",
      user_message: { id: "user-2" },
      model_item: { id: "llama" },
      tool_ids: ["search"],
      filter_ids: ["filter-1"],
      features: {
        web_search: true,
        image_generation: false,
        code_interpreter: false,
        memory: false
      },
      stream_options: { include_usage: true }
    });
    expect(payload.params).toEqual({});
    expect(payload.variables).toEqual({});
    expect(payload.metadata.variables).toEqual({});
    expect(payload.background_tasks).toEqual({});
    expect(payload.tool_servers).toEqual([]);
  });

  it("omits chat identifiers for pipe models", () => {
    const payload = buildCompletionPayload({
      modelId: "pipe-model",
      chatId: "chat-1",
      sessionId: "session-1",
      assistantMessageId: "assistant-1",
      messages: [{ role: "user", content: "hello" }],
      isPipeModel: true
    });

    expect(payload.chat_id).toBeUndefined();
    expect(payload.session_id).toBeUndefined();
    expect(payload.id).toBeUndefined();
  });

  it("does not send empty tool_ids or filter_ids arrays", () => {
    const payload = buildCompletionPayload({
      modelId: "llama",
      messages: [{ role: "user", content: "hello" }],
      toolIds: [],
      filterIds: []
    });

    expect("tool_ids" in payload).toBe(false);
    expect("filter_ids" in payload).toBe(false);
  });
});
```

- [ ] **Step 2: Run failing payload tests**

Run: `npm test -- src/lib/openwebui/requestBuilders.test.ts`

Expected: FAIL because `requestBuilders.ts` does not exist.

- [ ] **Step 3: Implement payload builder**

Create `src/lib/openwebui/requestBuilders.ts`:

```ts
import {
  BuildCompletionPayloadInput,
  ChatCompletionRequest,
  defaultFeatureFlags
} from "./types";

export function buildCompletionPayload(input: BuildCompletionPayloadInput): ChatCompletionRequest {
  const variables = input.variables ?? {};
  const payload: ChatCompletionRequest = {
    stream: true,
    model: input.modelId,
    messages: input.messages,
    parent_id: input.parentId,
    user_message: input.userMessage,
    model_item: input.modelItem,
    features: {
      ...defaultFeatureFlags,
      ...input.features
    },
    params: input.params ?? {},
    variables,
    metadata: {
      variables
    },
    stream_options: {
      include_usage: true
    },
    background_tasks: input.backgroundTasks ?? {},
    tool_servers: input.toolServers ?? []
  };

  if (!input.isPipeModel) {
    payload.chat_id = input.chatId;
    payload.session_id = input.sessionId;
    payload.id = input.assistantMessageId;
  }

  if (input.toolIds?.length) {
    payload.tool_ids = input.toolIds;
  }

  if (input.filterIds?.length) {
    payload.filter_ids = input.filterIds;
  }

  return payload;
}
```

- [ ] **Step 4: Run payload tests**

Run: `npm test -- src/lib/openwebui/requestBuilders.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openwebui/requestBuilders.ts src/lib/openwebui/requestBuilders.test.ts
git commit -m "feat: build open webui completion payloads"
```

## Task 3: Streaming Parser

**Files:**
- Create: `src/lib/openwebui/stream.ts`
- Create: `src/lib/openwebui/stream.test.ts`

- [ ] **Step 1: Write streaming tests**

Create `src/lib/openwebui/stream.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSSELine, readStreamEvents } from "./stream";

describe("stream", () => {
  it("parses OpenAI delta content from SSE data lines", () => {
    expect(parseSSELine('data: {"choices":[{"delta":{"content":"hi"}}]}')).toEqual({
      type: "content",
      content: "hi"
    });
  });

  it("parses done sentinel", () => {
    expect(parseSSELine("data: [DONE]")).toEqual({ type: "done" });
  });

  it("parses status events", () => {
    expect(parseSSELine('data: {"status":"Searching"}')).toEqual({
      type: "status",
      status: "Searching",
      raw: { status: "Searching" }
    });
  });

  it("reads content from a response body", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"he"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"llo"}}]}\n\n'));
        controller.close();
      }
    });

    const events = [];
    for await (const event of readStreamEvents(stream)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "content", content: "he" },
      { type: "content", content: "llo" }
    ]);
  });
});
```

- [ ] **Step 2: Run failing streaming tests**

Run: `npm test -- src/lib/openwebui/stream.test.ts`

Expected: FAIL because `stream.ts` does not exist.

- [ ] **Step 3: Implement stream helpers**

Create `src/lib/openwebui/stream.ts`:

```ts
import { StreamEvent } from "./types";

export function parseSSELine(line: string): StreamEvent | undefined {
  if (!line.startsWith("data:")) {
    return undefined;
  }

  const data = line.slice(5).trim();
  if (!data) {
    return undefined;
  }

  if (data === "[DONE]") {
    return { type: "done" };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(data) as Record<string, unknown>;
  } catch {
    return { type: "content", content: data };
  }

  const choices = parsed.choices as Array<{ delta?: { content?: string }; message?: { content?: string } }> | undefined;
  const content = choices?.[0]?.delta?.content ?? choices?.[0]?.message?.content;

  if (typeof content === "string" && content.length > 0) {
    return { type: "content", content };
  }

  if (typeof parsed.status === "string") {
    return { type: "status", status: parsed.status, raw: parsed };
  }

  if (parsed.usage && typeof parsed.usage === "object") {
    return { type: "usage", usage: parsed.usage as Record<string, unknown> };
  }

  if (typeof parsed.error === "string") {
    return { type: "error", message: parsed.error, raw: parsed };
  }

  return undefined;
}

export async function* readStreamEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseSSELine(line);
      if (event) {
        yield event;
      }
    }
  }

  const tail = parseSSELine(buffer);
  if (tail) {
    yield tail;
  }
}
```

- [ ] **Step 4: Run streaming tests**

Run: `npm test -- src/lib/openwebui/stream.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openwebui/stream.ts src/lib/openwebui/stream.test.ts
git commit -m "feat: parse open webui streaming events"
```

## Task 4: Chat API Client Endpoints

**Files:**
- Modify: `src/lib/openwebui/client.ts`
- Modify: `src/lib/openwebui/client.test.ts`

- [ ] **Step 1: Add chat endpoint tests**

Append to `src/lib/openwebui/client.test.ts`:

```ts
it("fetches recent chats and chat details", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(JSON.stringify([{ id: "chat-1", title: "Hello" }]), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chat-1", title: "Hello", chat: { messages: {} } }), { status: 200 }));

  const client = new OpenWebUIClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "token-1"
  });

  await expect(client.getChats({ page: 1 })).resolves.toEqual([
    { id: "chat-1", title: "Hello", raw: { id: "chat-1", title: "Hello" } }
  ]);
  await expect(client.getChat("chat-1")).resolves.toMatchObject({ id: "chat-1", title: "Hello" });
});

it("creates and updates server-side chats", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chat-1", title: "New Chat" }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: "chat-1", title: "New Chat" }), { status: 200 }));

  const client = new OpenWebUIClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "token-1"
  });

  await expect(client.createChat({ title: "New Chat", chat: { messages: {} } })).resolves.toMatchObject({
    id: "chat-1"
  });
  await expect(client.updateChat("chat-1", { chat: { messages: {} } })).resolves.toMatchObject({
    id: "chat-1"
  });
});
```

- [ ] **Step 2: Run failing client tests**

Run: `npm test -- src/lib/openwebui/client.test.ts`

Expected: FAIL because chat methods are missing.

- [ ] **Step 3: Add chat methods to client**

Add these methods inside `OpenWebUIClient` in `src/lib/openwebui/client.ts`:

```ts
async getChats(options: { page?: number } = {}): Promise<ChatSummary[]> {
  const page = options.page ?? 1;
  const response = await this.request<Array<Record<string, unknown>>>(
    `/api/v1/chats/?page=${page}&include_folders=false&include_pinned=true`
  );

  return response.map((chat) => ({
    id: String(chat.id),
    title: String(chat.title ?? "Untitled chat"),
    updatedAt: typeof chat.updated_at === "number" ? chat.updated_at : undefined,
    pinned: Boolean(chat.pinned),
    raw: chat
  }));
}

async getPinnedChats(): Promise<ChatSummary[]> {
  const response = await this.request<Array<Record<string, unknown>>>("/api/v1/chats/pinned");
  return response.map((chat) => ({
    id: String(chat.id),
    title: String(chat.title ?? "Untitled chat"),
    updatedAt: typeof chat.updated_at === "number" ? chat.updated_at : undefined,
    pinned: true,
    raw: chat
  }));
}

async getChat(chatId: string): Promise<ChatTree> {
  const chat = await this.request<Record<string, unknown>>(`/api/v1/chats/${encodeURIComponent(chatId)}`);
  return {
    id: String(chat.id),
    title: String(chat.title ?? "Untitled chat"),
    messages: {},
    raw: chat
  };
}

async createChat(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return this.request<Record<string, unknown>>("/api/v1/chats/new", {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async updateChat(chatId: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return this.request<Record<string, unknown>>(`/api/v1/chats/${encodeURIComponent(chatId)}`, {
    method: "POST",
    body: JSON.stringify(body)
  });
}

async streamChatCompletion(body: ChatCompletionRequest): Promise<ReadableStream<Uint8Array>> {
  const response = await this.rawRequest("/api/chat/completions", {
    method: "POST",
    body: JSON.stringify(body)
  });

  if (!response.body) {
    throw new OpenWebUIError("ServerUnreachableError", "Open WebUI did not return a stream");
  }

  return response.body;
}

async completeChat(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return this.request<Record<string, unknown>>("/api/chat/completed", {
    method: "POST",
    body: JSON.stringify(body)
  });
}
```

Also import `ChatCompletionRequest`, `ChatSummary`, and `ChatTree` from `./types`.

Add this private helper below `request` or refactor `request` to use it:

```ts
private async rawRequest(
  path: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<Response> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  if (!options.skipAuth) {
    const token = await this.getToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers
    });
  } catch {
    throw new OpenWebUIError("ServerUnreachableError", "Unable to reach Open WebUI server");
  }

  if (response.status === 401 || response.status === 403) {
    throw new OpenWebUIError("TokenExpiredError", "Open WebUI session expired", response.status);
  }

  if (!response.ok) {
    const code = path.includes("signin") ? "AuthFailedError" : "ServerUnreachableError";
    throw new OpenWebUIError(code, `Open WebUI request failed with ${response.status}`, response.status);
  }

  return response;
}
```

Then update `request<T>()` to call `const response = await this.rawRequest(path, options); return response.json() as Promise<T>;`.

- [ ] **Step 4: Run client tests**

Run: `npm test -- src/lib/openwebui/client.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/openwebui/client.ts src/lib/openwebui/client.test.ts
git commit -m "feat: add open webui chat endpoints"
```

## Task 5: Chat Runtime

**Files:**
- Create: `src/lib/runtime/chatRuntime.ts`
- Create: `src/lib/runtime/chatRuntime.test.ts`

- [ ] **Step 1: Write runtime tests**

Create `src/lib/runtime/chatRuntime.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { sendMessage } from "./chatRuntime";

describe("chatRuntime", () => {
  it("creates payload, streams content, finalizes chat, and refetches server chat", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      }
    });
    const client = {
      streamChatCompletion: vi.fn(async () => stream),
      completeChat: vi.fn(async () => ({ ok: true })),
      getChat: vi.fn(async () => ({ id: "chat-1", title: "Chat", messages: {} }))
    };
    const chunks: string[] = [];

    const result = await sendMessage({
      client,
      modelId: "llama",
      chatId: "chat-1",
      sessionId: "session-1",
      parentId: "user-1",
      prompt: "Hi",
      previousMessages: [],
      onContent: (content) => chunks.push(content)
    });

    expect(chunks).toEqual(["Hello"]);
    expect(client.completeChat).toHaveBeenCalled();
    expect(client.getChat).toHaveBeenCalledWith("chat-1");
    expect(result.assistantText).toBe("Hello");
  });
});
```

- [ ] **Step 2: Run failing runtime tests**

Run: `npm test -- src/lib/runtime/chatRuntime.test.ts`

Expected: FAIL because `chatRuntime.ts` does not exist.

- [ ] **Step 3: Implement chat runtime**

Create `src/lib/runtime/chatRuntime.ts`:

```ts
import { buildCompletionPayload } from "../openwebui/requestBuilders";
import { readStreamEvents } from "../openwebui/stream";
import {
  BuildCompletionPayloadInput,
  ChatCompletionRequest,
  ChatTree,
  StreamEvent
} from "../openwebui/types";

type ChatClient = {
  streamChatCompletion: (body: ChatCompletionRequest) => Promise<ReadableStream<Uint8Array>>;
  completeChat: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getChat: (chatId: string) => Promise<ChatTree>;
};

type SendMessageInput = Omit<BuildCompletionPayloadInput, "messages" | "userMessage"> & {
  client: ChatClient;
  prompt: string;
  previousMessages: Array<Record<string, unknown>>;
  onContent?: (content: string) => void;
  onEvent?: (event: StreamEvent) => void;
};

type SendMessageResult = {
  assistantText: string;
  refreshedChat?: ChatTree;
};

export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: input.prompt
  };
  const assistantMessageId = input.assistantMessageId ?? crypto.randomUUID();
  const payload = buildCompletionPayload({
    ...input,
    assistantMessageId,
    messages: [...input.previousMessages, { role: "user", content: input.prompt }],
    userMessage
  });

  const stream = await input.client.streamChatCompletion(payload);
  let assistantText = "";

  for await (const event of readStreamEvents(stream)) {
    input.onEvent?.(event);
    if (event.type === "content") {
      assistantText += event.content;
      input.onContent?.(event.content);
    }
    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  await input.client.completeChat({
    chat_id: input.chatId,
    id: assistantMessageId,
    model: input.modelId,
    messages: payload.messages
  });

  const refreshedChat = input.chatId ? await input.client.getChat(input.chatId) : undefined;
  return { assistantText, refreshedChat };
}
```

- [ ] **Step 4: Run runtime tests**

Run: `npm test -- src/lib/runtime/chatRuntime.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runtime/chatRuntime.ts src/lib/runtime/chatRuntime.test.ts
git commit -m "feat: orchestrate streaming chat runtime"
```

## Task 6: Proof Harness

**Files:**
- Create: `scripts/openwebui-poc.ts`
- Modify: `package.json`

- [ ] **Step 1: Add harness script to package**

Add this script to `package.json`:

```json
"poc:openwebui": "tsx scripts/openwebui-poc.ts"
```

Add this dev dependency if `tsx` is not present:

```json
"tsx": "^4.19.0"
```

- [ ] **Step 2: Create POC harness**

Create `scripts/openwebui-poc.ts`:

```ts
import { OpenWebUIClient } from "../src/lib/openwebui/client";

const serverUrl = process.env.OPENWEBUI_URL;
const email = process.env.OPENWEBUI_EMAIL;
const password = process.env.OPENWEBUI_PASSWORD;

if (!serverUrl || !email || !password) {
  throw new Error("Set OPENWEBUI_URL, OPENWEBUI_EMAIL, and OPENWEBUI_PASSWORD");
}

let token: string | undefined;
const client = new OpenWebUIClient({
  baseUrl: serverUrl,
  getToken: async () => token
});

console.log("1. Probing config");
await client.probeConfig();

console.log("2. Signing in");
const signIn = await client.signIn({ email, password });
token = signIn.token;

console.log("3. Fetching current user");
const user = await client.getCurrentUser();
console.log(`Current user: ${user.email ?? user.name ?? "unknown"}`);

console.log("4. Fetching models");
const models = await client.getModels();
console.log(`Models: ${models.map((model) => model.id).join(", ")}`);

if (models[0]) {
  console.log("5. Fetching first model detail");
  const detail = await client.getModelDetail(models[0].id);
  console.log(`Model detail loaded: ${detail.id}`);
}

console.log("6. Fetching recent chats");
const chats = await client.getChats({ page: 1 });
console.log(`Recent chats: ${chats.length}`);
```

- [ ] **Step 3: Run harness against target server**

Run:

```bash
OPENWEBUI_URL=http://localhost:3000 OPENWEBUI_EMAIL=user@example.com OPENWEBUI_PASSWORD=secret npm run poc:openwebui
```

Expected: the script prints successful config probe, sign-in, current user, models, first model detail when a model exists, and recent chat count.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json scripts/openwebui-poc.ts
git commit -m "chore: add open webui poc harness"
```

## Self-Review

- PRD coverage: server-side chat foundation, streaming default path, recent chat list, full history paging entry point, model detail, and server-side finalization are covered.
- Technical design coverage: `/api/v1/chats/`, `/api/v1/chats/pinned`, `/api/v1/chats/:id`, `/api/v1/chats/new`, `/api/chat/completions`, `/api/chat/completed`, Open WebUI-shaped completion payloads, pipe model identifier omission, SSE parsing, and POC gates 1-6 are covered directly.
- Deferred to tools and tabs plan: tool discovery, feature default merging, selected tab prompt augmentation, UI menus, markdown rendering, and manual Chrome tests.
- Placeholder scan: no placeholder terms are used as implementation instructions.
- Type consistency: `ChatCompletionRequest`, `BuildCompletionPayloadInput`, `StreamEvent`, `ChatSummary`, and `ChatTree` are introduced before runtime usage.
