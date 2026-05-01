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

function requireMutationOptIn() {
  if (process.env.OPENWEBUI_CHAT_MUTATE !== "1") {
    throw new Error(
      "Refusing to send a chat request without OPENWEBUI_CHAT_MUTATE=1"
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

function extractContentFromData(data) {
  if (data === "[DONE]") {
    return { done: true, content: "" };
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { done: false, content: data };
  }

  const content =
    parsed?.choices?.[0]?.delta?.content ??
    parsed?.choices?.[0]?.message?.content ??
    parsed?.content ??
    "";

  if (typeof parsed?.error === "string") {
    throw new Error(parsed.error);
  }

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

      const event = extractContentFromData(line.slice(5).trim());
      if (event.done) {
        return assistantText;
      }

      assistantText += event.content;
      if (assistantText.length > options.maxCharacters) {
        throw new Error(
          `Assistant response exceeded OPENWEBUI_CHAT_MAX_CHARS=${options.maxCharacters}`
        );
      }
    }
  }

  return assistantText;
}

async function main() {
  requireMutationOptIn();

  const baseUrl = normalizeBaseUrl(requireEnv("OPENWEBUI_URL"));
  const email = requireEnv("OPENWEBUI_EMAIL");
  const password = requireEnv("OPENWEBUI_PASSWORD");
  const modelId = requireEnv("OPENWEBUI_CHAT_MODEL_ID");
  const prompt =
    process.env.OPENWEBUI_CHAT_PROMPT?.trim() ||
    "Reply with exactly this text and no extra words: open-webui-extension-smoke-ok";
  const timeoutMs = Number(process.env.OPENWEBUI_CHAT_TIMEOUT_MS ?? 60000);
  const maxCharacters = Number(process.env.OPENWEBUI_CHAT_MAX_CHARS ?? 2000);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    console.log("Open WebUI chat send smoke");
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

    const stream = await requestStream(baseUrl, "/api/chat/completions", {
      method: "POST",
      headers: {
        ...authHeaders,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        stream: true,
        model: modelId,
        messages: [{ role: "user", content: prompt }],
        features: {
          web_search: false,
          image_generation: false,
          code_interpreter: false,
          memory: false
        },
        params: {},
        variables: {},
        metadata: {
          variables: {}
        },
        stream_options: {
          include_usage: true
        },
        background_tasks: {},
        tool_servers: []
      }),
      signal: controller.signal
    });

    const assistantText = await readAssistantText(stream, { maxCharacters });
    if (!assistantText.trim()) {
      throw new Error("Assistant response did not include text content");
    }

    console.log(`- assistant text chars: ${assistantText.length}`);
    console.log(`- assistant preview: ${assistantText.slice(0, 200).replace(/\s+/g, " ")}`);
    console.log("Open WebUI chat send smoke passed");
  } finally {
    clearTimeout(timeout);
  }
}

try {
  await main();
} catch (error) {
  console.error(`Open WebUI chat send smoke failed: ${error.message}`);
  process.exitCode = 1;
}
