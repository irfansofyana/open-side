import { pathToFileURL } from "node:url";

const requiredEnv = [
  "OPENWEBUI_URL",
  "OPENWEBUI_EMAIL",
  "OPENWEBUI_PASSWORD",
  "OPENWEBUI_CHAT_MODEL_ID"
];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Required: ${requiredEnv.join(", ")}`);
  }
  return value;
}

function requirePersistenceOptIn() {
  if (process.env.OPENWEBUI_CHAT_PERSIST !== "1") {
    throw new Error(
      "Refusing to create persistent chat history without OPENWEBUI_CHAT_PERSIST=1"
    );
  }
}

function normalizeBaseUrl(input) {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OPENWEBUI_URL must use http or https");
  }
  return url.toString().replace(/\/+$/, "");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readChat(value) {
  if (!isRecord(value)) {
    return {};
  }
  return isRecord(value.chat) ? value.chat : value;
}

function buildUserMessage({ modelId, prompt, timestamp, userMessageId }) {
  return {
    id: userMessageId,
    role: "user",
    content: prompt,
    timestamp,
    models: [modelId],
    childrenIds: []
  };
}

function buildAssistantMessage({
  assistantMessageId,
  modelId,
  timestamp,
  userMessageId,
  content = ""
}) {
  return {
    id: assistantMessageId,
    parentId: userMessageId,
    role: "assistant",
    content,
    timestamp,
    childrenIds: [],
    model: modelId,
    modelName: modelId,
    modelIdx: 0,
    done: false
  };
}

export function buildInitialChatMutation({
  assistantMessageId,
  modelId,
  prompt,
  title,
  timestamp,
  userMessageId
}) {
  const userMessage = buildUserMessage({ modelId, prompt, timestamp, userMessageId });
  const assistantMessage = buildAssistantMessage({
    assistantMessageId,
    modelId,
    timestamp: timestamp + 1,
    userMessageId
  });
  userMessage.childrenIds = [assistantMessageId];

  return {
    chat: {
      title,
      models: [modelId],
      currentId: assistantMessageId,
      messages: [userMessage, assistantMessage],
      history: {
        currentId: assistantMessageId,
        messages: {
          [userMessageId]: userMessage,
          [assistantMessageId]: assistantMessage
        }
      }
    }
  };
}

export function buildAssistantPlaceholderMutation({
  assistantMessageId,
  chat,
  modelId,
  timestamp,
  userMessageId
}) {
  const currentChat = readChat(chat);
  const history = isRecord(currentChat.history) ? currentChat.history : {};
  const historyMessages = isRecord(history.messages) ? history.messages : {};
  const existingMessages = Array.isArray(currentChat.messages) ? currentChat.messages : [];
  const assistantMessage = buildAssistantMessage({
    assistantMessageId,
    modelId,
    timestamp,
    userMessageId
  });
  const nextMessages = existingMessages.map((message) => {
    if (!isRecord(message) || message.id !== userMessageId) {
      return message;
    }

    return {
      ...message,
      childrenIds: [assistantMessageId]
    };
  });
  const nextHistoryMessages = { ...historyMessages };
  const parentMessage = nextHistoryMessages[userMessageId];

  if (isRecord(parentMessage)) {
    nextHistoryMessages[userMessageId] = {
      ...parentMessage,
      childrenIds: [assistantMessageId]
    };
  }

  return {
    chat: {
      ...currentChat,
      models: Array.isArray(currentChat.models) ? currentChat.models : [modelId],
      currentId: assistantMessageId,
      messages: [...nextMessages, assistantMessage],
      history: {
        ...history,
        currentId: assistantMessageId,
        messages: {
          ...nextHistoryMessages,
          [assistantMessageId]: assistantMessage
        }
      }
    }
  };
}

export function buildCompletedMutation({
  assistantText,
  assistantMessageId,
  chatId,
  modelId,
  sessionId,
  userMessageId
}) {
  const assistantMessage = buildAssistantMessage({
    assistantMessageId,
    modelId,
    timestamp: Date.now(),
    userMessageId,
    content: assistantText
  });

  return {
    chat_id: chatId,
    id: assistantMessageId,
    session_id: sessionId,
    model: modelId,
    message: assistantMessage
  };
}

export function buildCompletionRequest({
  assistantMessageId,
  chatId,
  features = {
    web_search: false,
    image_generation: false,
    code_interpreter: false,
    memory: false
  },
  modelId,
  modelItem,
  prompt,
  sessionId,
  userMessage,
  userMessageId
}) {
  return {
    stream: true,
    model: modelId,
    chat_id: chatId,
    id: assistantMessageId,
    session_id: sessionId,
    parent_id: userMessageId,
    messages: [{ role: "user", content: prompt }],
    user_message: userMessage,
    model_item: modelItem,
    features,
    params: {},
    variables: {},
    metadata: {
      variables: {}
    },
    stream_options: {
      include_usage: true
    },
    background_tasks: {
      title_generation: true,
      tags_generation: false,
      follow_up_generation: false
    },
    tool_servers: []
  };
}

export function selectAssistantText({ streamedText, persistedText, diagnostics }) {
  if (streamedText.trim()) {
    return streamedText;
  }

  if (persistedText.trim()) {
    return persistedText;
  }

  const previews = diagnostics.previews.join(" | ") || "no data lines";
  throw new Error(
    `Assistant response did not include text content ` +
      `(data lines: ${diagnostics.dataLines}, empty content events: ${diagnostics.emptyContentEvents}, done seen: ${diagnostics.doneSeen}, previews: ${previews})`
  );
}

export function findPersistedAssistantText(chatDetail, assistantMessageId) {
  const chat = readChat(chatDetail);
  const history = isRecord(chat.history) ? chat.history : {};
  const historyMessages = isRecord(history.messages) ? history.messages : {};
  const historyMessage = historyMessages[assistantMessageId];

  if (isRecord(historyMessage) && typeof historyMessage.content === "string") {
    return historyMessage.content;
  }

  const arrayMessage = Array.isArray(chat.messages)
    ? chat.messages.find(
        (message) => isRecord(message) && message.id === assistantMessageId
      )
    : undefined;

  return isRecord(arrayMessage) && typeof arrayMessage.content === "string"
    ? arrayMessage.content
    : "";
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new Error(`Request failed: ${path} returned HTTP ${response.status}`);
  }

  return data;
}

async function requestStream(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${path} returned HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error(`Request failed: ${path} did not return a stream`);
  }
  return response.body;
}

export function extractContentFromData(data) {
  if (data === "[DONE]") {
    return { done: true, content: "" };
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { done: false, content: data };
  }

  if (typeof parsed?.error === "string") {
    throw new Error(parsed.error);
  }

  const content =
    parsed?.choices?.[0]?.delta?.content ??
    parsed?.choices?.[0]?.message?.content ??
    parsed?.data?.content ??
    parsed?.content ??
    "";

  return {
    done: false,
    content: typeof content === "string" ? content : ""
  };
}

async function readAssistantText(stream, options) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let assistantText = "";
  const diagnostics = {
    dataLines: 0,
    doneSeen: false,
    emptyContentEvents: 0,
    previews: []
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) {
        continue;
      }

      const data = line.slice(5).trim();
      diagnostics.dataLines += 1;
      if (diagnostics.previews.length < 5) {
        diagnostics.previews.push(data.slice(0, 240));
      }

      const event = extractContentFromData(data);
      if (event.done) {
        diagnostics.doneSeen = true;
        return { text: assistantText, diagnostics };
      }

      if (!event.content) {
        diagnostics.emptyContentEvents += 1;
      }
      assistantText += event.content;
      if (assistantText.length > options.maxCharacters) {
        throw new Error(
          `Assistant response exceeded OPENWEBUI_CHAT_MAX_CHARS=${options.maxCharacters}`
        );
      }
    }
  }

  return { text: assistantText, diagnostics };
}

function getCreatedChatId(createdChat) {
  const chat = readChat(createdChat);
  const id = createdChat?.id ?? chat.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Created chat response did not include an id");
  }

  return id;
}

async function main() {
  requirePersistenceOptIn();

  const baseUrl = normalizeBaseUrl(requireEnv("OPENWEBUI_URL"));
  const email = requireEnv("OPENWEBUI_EMAIL");
  const password = requireEnv("OPENWEBUI_PASSWORD");
  const modelId = requireEnv("OPENWEBUI_CHAT_MODEL_ID");
  const prompt =
    process.env.OPENWEBUI_CHAT_PROMPT?.trim() ||
    "Reply with exactly this text and no extra words: open-webui-extension-persist-ok";
  const timeoutMs = Number(process.env.OPENWEBUI_CHAT_TIMEOUT_MS ?? 60000);
  const maxCharacters = Number(process.env.OPENWEBUI_CHAT_MAX_CHARS ?? 2000);
  const title = `Extension smoke ${new Date().toISOString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log("Open WebUI persistent chat smoke");
    console.log(`- server: ${baseUrl}`);
    console.log(`- user: ${email}`);
    console.log(`- selected model: ${modelId}`);

    const signIn = await requestJson(baseUrl, "/api/v1/auths/signin", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal
    });
    const token = signIn?.token ?? signIn?.access_token;
    if (typeof token !== "string" || token.length === 0) {
      throw new Error("Sign-in response did not include a token");
    }
    console.log("- sign-in: ok");

    const authHeaders = {
      authorization: `Bearer ${token}`
    };
    const modelsResponse = await requestJson(baseUrl, "/api/models", {
      headers: authHeaders,
      signal: controller.signal
    });
    const models = Array.isArray(modelsResponse) ? modelsResponse : modelsResponse?.data;
    if (!Array.isArray(models)) {
      throw new Error("Models response was not an array or { data: array }");
    }
    const selectedModel = models.find((model) => model?.id === modelId);
    if (!selectedModel) {
      throw new Error(`Selected model was not found: ${modelId}`);
    }
    console.log(`- model found: ${selectedModel.name ?? selectedModel.id}`);

    const userMessageId = crypto.randomUUID();
    const assistantMessageId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const initialPayload = buildInitialChatMutation({
      assistantMessageId,
      modelId,
      prompt,
      title,
      timestamp: now,
      userMessageId
    });
    const createdChat = await requestJson(baseUrl, "/api/v1/chats/new", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify(initialPayload),
      signal: controller.signal
    });
    const chatId = getCreatedChatId(createdChat);
    console.log(`- chat created: ${chatId}`);
    console.log("- assistant placeholder: created with chat");

    const modelItem = await requestJson(
      baseUrl,
      `/api/v1/models/model?id=${encodeURIComponent(modelId)}`,
      {
        headers: authHeaders,
        signal: controller.signal
      }
    );
    console.log("- model detail: ok");

    const userMessage = readChat(initialPayload).history.messages[userMessageId];
    const stream = await requestStream(baseUrl, "/api/chat/completions", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify(
        buildCompletionRequest({
          assistantMessageId,
          chatId,
          modelId,
          modelItem,
          prompt,
          sessionId,
          userMessage,
          userMessageId
        })
      ),
      signal: controller.signal
    });

    const streamResult = await readAssistantText(stream, { maxCharacters });
    const refetchedChatBeforeComplete = await requestJson(
      baseUrl,
      `/api/v1/chats/${encodeURIComponent(chatId)}`,
      {
        headers: authHeaders,
        signal: controller.signal
      }
    );
    const assistantText = selectAssistantText({
      streamedText: streamResult.text,
      persistedText: findPersistedAssistantText(refetchedChatBeforeComplete, assistantMessageId),
      diagnostics: streamResult.diagnostics
    });
    console.log(`- assistant text chars: ${assistantText.length}`);
    console.log(`- assistant preview: ${assistantText.slice(0, 200).replace(/\s+/g, " ")}`);

    await requestJson(baseUrl, "/api/chat/completed", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify(
        buildCompletedMutation({
          assistantText,
          assistantMessageId,
          chatId,
          modelId,
          sessionId,
          userMessageId
        })
      ),
      signal: controller.signal
    });
    console.log("- completion finalized: ok");

    const refetchedChat = await requestJson(
      baseUrl,
      `/api/v1/chats/${encodeURIComponent(chatId)}`,
      {
        headers: authHeaders,
        signal: controller.signal
      }
    );
    const persistedText = findPersistedAssistantText(refetchedChat, assistantMessageId);
    if (!persistedText.trim()) {
      throw new Error("Refetched chat did not include persisted assistant text");
    }
    console.log(`- refetched persisted chars: ${persistedText.length}`);
    console.log("Open WebUI persistent chat smoke passed");
  } finally {
    clearTimeout(timeout);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try {
    await main();
  } catch (error) {
    console.error(`Open WebUI persistent chat smoke failed: ${error.message}`);
    process.exitCode = 1;
  }
}
