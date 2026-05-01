const requiredEnv = ["OPENWEBUI_URL", "OPENWEBUI_EMAIL", "OPENWEBUI_PASSWORD"];

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}. Required: ${requiredEnv.join(", ")}`);
  }
  return value;
}

function normalizeBaseUrl(input) {
  const url = new URL(input.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("OPENWEBUI_URL must use http or https");
  }
  return url.toString().replace(/\/+$/, "");
}

function looksLikeOpenWebUIConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return (
    Object.keys(value).some((key) => key.toLowerCase().includes("webui")) ||
    Object.values(value).some(
      (entry) => typeof entry === "string" && entry.toLowerCase().includes("open webui")
    )
  );
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

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv("OPENWEBUI_URL"));
  const email = requireEnv("OPENWEBUI_EMAIL");
  const password = requireEnv("OPENWEBUI_PASSWORD");

  console.log("Open WebUI live smoke");
  console.log(`- server: ${baseUrl}`);
  console.log(`- user: ${email}`);

  const config = await requestJson(baseUrl, "/api/config");
  if (!looksLikeOpenWebUIConfig(config)) {
    throw new Error("Config response did not look like Open WebUI");
  }
  console.log("- config probe: ok");

  const signIn = await requestJson(baseUrl, "/api/v1/auths/signin", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  const token = signIn?.token ?? signIn?.access_token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("Sign-in response did not include a token");
  }
  console.log("- sign-in: ok");

  const authHeaders = {
    authorization: `Bearer ${token}`
  };

  const user = await requestJson(baseUrl, "/api/v1/auths/", {
    headers: authHeaders
  });
  console.log(`- current user: ${user?.email ?? user?.name ?? user?.id ?? "ok"}`);

  const modelsResponse = await requestJson(baseUrl, "/api/models", {
    headers: authHeaders
  });
  const models = Array.isArray(modelsResponse) ? modelsResponse : modelsResponse?.data;
  if (!Array.isArray(models)) {
    throw new Error("Models response was not an array or { data: array }");
  }
  console.log(`- models: ${models.length}`);

  const modelId = process.env.OPENWEBUI_MODEL_ID?.trim() || models[0]?.id;
  if (modelId) {
    const detail = await requestJson(
      baseUrl,
      `/api/v1/models/model?id=${encodeURIComponent(modelId)}`,
      { headers: authHeaders }
    );
    console.log(`- model detail: ${detail?.id ?? modelId}`);
  } else {
    console.log("- model detail: skipped; no models returned");
  }

  const chatsResponse = await requestJson(
    baseUrl,
    "/api/v1/chats/?page=1&include_folders=false&include_pinned=true",
    { headers: authHeaders }
  );
  const chats = Array.isArray(chatsResponse) ? chatsResponse : chatsResponse?.data;
  if (!Array.isArray(chats)) {
    throw new Error("Recent chats response was not an array or { data: array }");
  }
  console.log(`- recent chats: ${chats.length}`);

  const firstChat = chats.find((chat) => chat && typeof chat === "object" && chat.id);
  if (firstChat) {
    const chatDetail = await requestJson(
      baseUrl,
      `/api/v1/chats/${encodeURIComponent(firstChat.id)}`,
      { headers: authHeaders }
    );
    console.log(`- first chat detail: ${chatDetail?.title ?? chatDetail?.id ?? firstChat.id}`);
  } else {
    console.log("- first chat detail: skipped; no chats returned");
  }

  console.log("Open WebUI live smoke passed");
}

try {
  await main();
} catch (error) {
  console.error(`Open WebUI live smoke failed: ${error.message}`);
  process.exitCode = 1;
}
