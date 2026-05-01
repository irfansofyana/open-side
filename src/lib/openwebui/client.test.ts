import { vi } from "vitest";

import { OpenWebUIClient, normalizeBaseUrl } from "./client";
import { OpenWebUIError } from "./types";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
  });

test("normalizeBaseUrl trims slash and rejects invalid/non-http(s)", () => {
  expect(normalizeBaseUrl(" https://openwebui.example.com/ ")).toBe(
    "https://openwebui.example.com"
  );
  expect(normalizeBaseUrl("http://localhost:3000///")).toBe("http://localhost:3000");

  expect(() => normalizeBaseUrl("not a url")).toThrow(
    new OpenWebUIError("ServerUnreachableError", "Invalid server URL")
  );
  expect(() => normalizeBaseUrl("chrome-extension://extension-id")).toThrow(
    new OpenWebUIError("ServerUnreachableError", "Server URL must use http or https")
  );
});

test("probeConfig accepts plausible Open WebUI config and rejects non-Open-WebUI shape", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ webui_name: "Open WebUI", version: "0.5.0" }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com/",
    getToken: () => undefined
  });

  await expect(client.probeConfig()).resolves.toEqual({
    webui_name: "Open WebUI",
    version: "0.5.0"
  });
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/config", {
    headers: undefined,
    method: "GET"
  });

  fetchMock.mockResolvedValueOnce(jsonResponse({ name: "Something Else" }));

  await expect(client.probeConfig()).rejects.toMatchObject({
    code: "NotOpenWebUIError",
    message: "Server does not look like Open WebUI"
  });
});

test("probeConfig rejects generic config shapes", async () => {
  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com/",
    getToken: () => undefined
  });

  fetchMock.mockResolvedValueOnce(jsonResponse({ version: "1.0.0" }));

  await expect(client.probeConfig()).rejects.toMatchObject({
    code: "NotOpenWebUIError",
    message: "Server does not look like Open WebUI"
  });

  fetchMock.mockResolvedValueOnce(jsonResponse({ version: "1.0.0", features: {} }));

  await expect(client.probeConfig()).rejects.toMatchObject({
    code: "NotOpenWebUIError",
    message: "Server does not look like Open WebUI"
  });

  fetchMock.mockResolvedValueOnce(jsonResponse({ features: [] }));

  await expect(client.probeConfig()).rejects.toMatchObject({
    code: "NotOpenWebUIError",
    message: "Server does not look like Open WebUI"
  });
});

test("signIn posts email/password without auth and returns bearer token", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "token-1" }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "existing-token"
  });

  await expect(client.signIn({ email: "ada@example.com", password: "secret" })).resolves.toEqual({
    token: "token-1",
    tokenType: "Bearer"
  });
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/v1/auths/signin", {
    body: JSON.stringify({ email: "ada@example.com", password: "secret" }),
    headers: {
      "content-type": "application/json"
    },
    method: "POST"
  });
});

test("getCurrentUser attaches Authorization header", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: "user-1", email: "ada@example.com" }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getCurrentUser()).resolves.toEqual({
    id: "user-1",
    email: "ada@example.com"
  });
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/v1/auths/", {
    headers: {
      authorization: "Bearer token-1"
    },
    method: "GET"
  });
});

test("getModels supports { data: [...] } and array response", async () => {
  const firstModels = [{ id: "llama3.1", name: "Llama 3.1" }];
  const secondModels = [{ id: "mistral", name: "Mistral" }];
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ data: firstModels }))
    .mockResolvedValueOnce(jsonResponse(secondModels));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getModels()).resolves.toEqual(firstModels);
  await expect(client.getModels()).resolves.toEqual(secondModels);
});

test("getModelDetail URL-encodes model id", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: "openai/gpt-4o mini" }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getModelDetail("openai/gpt-4o mini")).resolves.toEqual({
    id: "openai/gpt-4o mini"
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://openwebui.example.com/api/v1/models/model?id=openai%2Fgpt-4o%20mini",
    {
      headers: {
        authorization: "Bearer token-1"
      },
      method: "GET"
    }
  );
});

test("getChats fetches default URL and normalizes array response", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse([
      {
        id: "chat-1",
        title: "First chat",
        updated_at: 1714528800,
        pinned: false
      }
    ])
  );

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getChats()).resolves.toEqual([
    {
      id: "chat-1",
      title: "First chat",
      updatedAt: 1714528800,
      pinned: false,
      raw: {
        id: "chat-1",
        title: "First chat",
        updated_at: 1714528800,
        pinned: false
      }
    }
  ]);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://openwebui.example.com/api/v1/chats/?page=1&include_folders=false&include_pinned=true",
    {
      headers: {
        authorization: "Bearer token-1"
      },
      method: "GET"
    }
  );
});

test("getChats supports data response and explicit paging options", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      data: [
        {
          id: "chat-2",
          title: null,
          updated_at: "not-a-number",
          pinned: true
        }
      ]
    })
  );

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getChats({ page: 3, includePinned: false })).resolves.toEqual([
    {
      id: "chat-2",
      title: "Untitled chat",
      pinned: true,
      raw: {
        id: "chat-2",
        title: null,
        updated_at: "not-a-number",
        pinned: true
      }
    }
  ]);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://openwebui.example.com/api/v1/chats/?page=3&include_folders=false&include_pinned=false",
    expect.any(Object)
  );
});

test("getPinnedChats normalizes pinned summaries", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      data: [
        {
          id: "chat-pinned",
          title: "Pinned chat"
        }
      ]
    })
  );

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getPinnedChats()).resolves.toEqual([
    {
      id: "chat-pinned",
      title: "Pinned chat",
      pinned: true,
      raw: {
        id: "chat-pinned",
        title: "Pinned chat"
      }
    }
  ]);
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/v1/chats/pinned", {
    headers: {
      authorization: "Bearer token-1"
    },
    method: "GET"
  });
});

test("getChat URL-encodes id and extracts chat messages", async () => {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({
      id: "folder/chat 1",
      title: "Chat detail",
      chat: {
        messages: {
          "message-1": { id: "message-1", role: "user", content: "Hello" }
        },
        currentId: "message-1"
      },
      updated_at: 1714528800,
      pinned: true
    })
  );

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getChat("folder/chat 1")).resolves.toMatchObject({
    id: "folder/chat 1",
    title: "Chat detail",
    messages: {
      "message-1": { id: "message-1", role: "user", content: "Hello" }
    },
    currentId: "message-1",
    updatedAt: 1714528800,
    pinned: true
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "https://openwebui.example.com/api/v1/chats/folder%2Fchat%201",
    {
      headers: {
        authorization: "Bearer token-1"
      },
      method: "GET"
    }
  );
});

test("getChat falls back to root messages and then empty messages", async () => {
  fetchMock
    .mockResolvedValueOnce(
      jsonResponse({
        id: "chat-root",
        title: "Root messages",
        messages: {
          "message-1": { id: "message-1", role: "assistant", content: "Hi" }
        }
      })
    )
    .mockResolvedValueOnce(jsonResponse({ id: "chat-empty" }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getChat("chat-root")).resolves.toMatchObject({
    id: "chat-root",
    title: "Root messages",
    messages: {
      "message-1": { id: "message-1", role: "assistant", content: "Hi" }
    }
  });
  await expect(client.getChat("chat-empty")).resolves.toMatchObject({
    id: "chat-empty",
    title: "Untitled chat",
    messages: {}
  });
});

test("createChat posts caller-provided chat payload", async () => {
  const payload = {
    chat: {
      title: "Extension smoke",
      messages: {}
    }
  };
  const responseBody = { id: "chat-1", title: "Extension smoke" };
  fetchMock.mockResolvedValueOnce(jsonResponse(responseBody));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.createChat(payload)).resolves.toEqual(responseBody);
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/v1/chats/new", {
    body: JSON.stringify(payload),
    headers: {
      authorization: "Bearer token-1",
      "content-type": "application/json"
    },
    method: "POST"
  });
});

test("updateChat URL-encodes chat id and posts caller-provided chat payload", async () => {
  const payload = {
    chat: {
      currentId: "assistant-1"
    }
  };
  const responseBody = { id: "folder/chat 1", title: "Updated chat" };
  fetchMock.mockResolvedValueOnce(jsonResponse(responseBody));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.updateChat("folder/chat 1", payload)).resolves.toEqual(responseBody);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://openwebui.example.com/api/v1/chats/folder%2Fchat%201",
    {
      body: JSON.stringify(payload),
      headers: {
        authorization: "Bearer token-1",
        "content-type": "application/json"
      },
      method: "POST"
    }
  );
});

test("completeChat posts caller-provided completion payload", async () => {
  const payload = {
    chat_id: "chat-1",
    message_id: "assistant-1",
    messages: [{ id: "assistant-1", role: "assistant", content: "Done" }]
  };
  const responseBody = { chat_id: "chat-1", message_id: "assistant-1" };
  fetchMock.mockResolvedValueOnce(jsonResponse(responseBody));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.completeChat(payload)).resolves.toEqual(responseBody);
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/chat/completed", {
    body: JSON.stringify(payload),
    headers: {
      authorization: "Bearer token-1",
      "content-type": "application/json"
    },
    method: "POST"
  });
});

test("streamChatCompletion posts Open WebUI payload and returns response body", async () => {
  const stream = new ReadableStream<Uint8Array>();
  fetchMock.mockResolvedValueOnce(new Response(stream, { status: 200 }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });
  const payload = {
    stream: true as const,
    model: "llama",
    messages: [{ role: "user", content: "hello" }],
    features: {
      web_search: false,
      image_generation: false,
      code_interpreter: false,
      memory: false
    },
    params: {},
    variables: {},
    metadata: { variables: {} },
    stream_options: { include_usage: true as const },
    background_tasks: {},
    tool_servers: []
  };

  await expect(client.streamChatCompletion(payload)).resolves.toBe(stream);
  expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/chat/completions", {
    body: JSON.stringify(payload),
    headers: {
      authorization: "Bearer token-1",
      "content-type": "application/json"
    },
    method: "POST"
  });
});

test("streamChatCompletion fails when response has no stream body", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(
    client.streamChatCompletion({
      stream: true,
      model: "llama",
      messages: [],
      features: {
        web_search: false,
        image_generation: false,
        code_interpreter: false,
        memory: false
      },
      params: {},
      variables: {},
      metadata: { variables: {} },
      stream_options: { include_usage: true },
      background_tasks: {},
      tool_servers: []
    })
  ).rejects.toMatchObject({
    code: "ServerUnreachableError",
    message: "Open WebUI did not return a stream"
  });
});

test("unauthorized response maps to TokenExpiredError", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Unauthorized" }, { status: 401 }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getCurrentUser()).rejects.toMatchObject({
    code: "TokenExpiredError",
    message: "Open WebUI session expired",
    status: 401
  });
});

test("forbidden response maps to TokenExpiredError", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Forbidden" }, { status: 403 }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getCurrentUser()).rejects.toMatchObject({
    code: "TokenExpiredError",
    message: "Open WebUI session expired",
    status: 403
  });
});

test("fetch rejection maps to ServerUnreachableError", async () => {
  fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => undefined
  });

  await expect(client.probeConfig()).rejects.toMatchObject({
    code: "ServerUnreachableError",
    message: "Unable to reach Open WebUI server"
  });
});

test("non-sign-in non-ok response maps to ServerUnreachableError", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Server error" }, { status: 500 }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => "token-1"
  });

  await expect(client.getModels()).rejects.toMatchObject({
    code: "ServerUnreachableError",
    message: "Open WebUI request failed",
    status: 500
  });
});

test("non-ok signin maps to AuthFailedError", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ detail: "Invalid login" }, { status: 400 }));

  const client = new OpenWebUIClient({
    baseUrl: "https://openwebui.example.com",
    getToken: () => undefined
  });

  await expect(client.signIn({ email: "ada@example.com", password: "wrong" })).rejects.toMatchObject({
    code: "AuthFailedError",
    message: "Open WebUI authentication failed",
    status: 400
  });
});
