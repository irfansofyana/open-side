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

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (isRecord(value) && Array.isArray(value.data)) {
    return value.data;
  }

  return [];
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

function describeItem(item) {
  if (!isRecord(item)) {
    return "unknown";
  }

  return item.name ?? item.id ?? "unnamed";
}

async function main() {
  const baseUrl = normalizeBaseUrl(requireEnv("OPENWEBUI_URL"));
  const email = requireEnv("OPENWEBUI_EMAIL");
  const password = requireEnv("OPENWEBUI_PASSWORD");

  console.log("Open WebUI tools smoke");
  console.log(`- server: ${baseUrl}`);
  console.log(`- user: ${email}`);

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
  const config = await requestJson(baseUrl, "/api/config", {
    headers: authHeaders
  });
  const webSearchEnabled = config?.features?.enable_web_search === true;
  console.log(`- web search config: ${webSearchEnabled ? "enabled" : "disabled"}`);

  const toolsResponse = await requestJson(baseUrl, "/api/v1/tools/list", {
    headers: authHeaders
  });
  const tools = asArray(toolsResponse).filter(isRecord);
  console.log(`- tools: ${tools.length}`);

  const selectedToolId = process.env.OPENWEBUI_TOOL_ID?.trim();
  const selectedTool = selectedToolId
    ? tools.find((tool) => tool.id === selectedToolId)
    : tools[0];

  if (selectedTool) {
    console.log(`- sample tool: ${describeItem(selectedTool)}`);
  } else {
    console.log("- sample tool: skipped; no accessible tools returned");
  }

  const functionsResponse = await requestJson(baseUrl, "/api/v1/functions/", {
    headers: authHeaders
  });
  const functions = asArray(functionsResponse).filter(isRecord);
  const filters = functions.filter((fn) => fn.type === "filter" && fn.is_active !== false);
  console.log(`- functions: ${functions.length}`);
  console.log(`- active filters: ${filters.length}`);

  if (filters[0]) {
    console.log(`- sample filter: ${describeItem(filters[0])}`);
  } else {
    console.log("- sample filter: skipped; no active filters returned");
  }

  console.log("Open WebUI tools smoke passed");
}

try {
  await main();
} catch (error) {
  console.error(`Open WebUI tools smoke failed: ${error.message}`);
  process.exitCode = 1;
}
