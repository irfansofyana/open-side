import {
  type BuildCompletionPayloadInput,
  type ChatCompletionRequest,
  defaultFeatureFlags
} from "./types";

type OpenWebUIPromptVariablesInput = {
  now?: Date;
  timeZone?: string;
  userLanguage?: string;
  userLocation?: string;
  userName?: string;
};

const getTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const getUserLanguage = (): string => {
  if (typeof navigator !== "undefined" && navigator.language) {
    return navigator.language;
  }

  return "en-US";
};

const getPart = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string =>
  parts.find((part) => part.type === type)?.value ?? "";

export function buildOpenWebUIPromptVariables({
  now = new Date(),
  timeZone = getTimeZone(),
  userLanguage = getUserLanguage(),
  userLocation = "Unknown",
  userName = ""
}: OpenWebUIPromptVariablesInput = {}): Record<string, string> {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    weekday: "long",
    year: "numeric"
  }).formatToParts(now);
  const year = getPart(parts, "year");
  const month = getPart(parts, "month");
  const day = getPart(parts, "day");
  const hour = getPart(parts, "hour");
  const minute = getPart(parts, "minute");
  const second = getPart(parts, "second");
  const date = `${year}-${month}-${day}`;
  const time = `${hour}:${minute}:${second}`;

  return {
    "{{CURRENT_DATE}}": date,
    "{{CURRENT_DATETIME}}": `${date} ${time}`,
    "{{CURRENT_TIME}}": time,
    "{{CURRENT_TIMEZONE}}": timeZone,
    "{{CURRENT_WEEKDAY}}": getPart(parts, "weekday"),
    "{{USER_LANGUAGE}}": userLanguage,
    "{{USER_LOCATION}}": userLocation,
    "{{USER_NAME}}": userName
  };
}

const getFunctionCallingMode = (modelItem: Record<string, unknown> | undefined): unknown => {
  const info = typeof modelItem?.info === "object" && modelItem.info !== null ? modelItem.info : undefined;
  const params =
    typeof info === "object" &&
    info !== null &&
    "params" in info &&
    typeof info.params === "object" &&
    info.params !== null
      ? info.params
      : undefined;

  return params && "function_calling" in params ? params.function_calling : undefined;
};

export function buildCompletionPayload(
  input: BuildCompletionPayloadInput
): ChatCompletionRequest {
  const variables = input.variables ?? {};
  const features = {
    ...defaultFeatureFlags,
    ...input.features
  };
  const toolServers = input.toolServers ?? [];
  const files = input.files ?? [];
  const functionCalling = getFunctionCallingMode(input.modelItem);
  const payload: ChatCompletionRequest = {
    stream: true,
    model: input.modelId,
    messages: input.messages,
    parent_id: input.parentId,
    user_message: input.userMessage,
    model_item: input.modelItem,
    features,
    params: input.params ?? {},
    variables,
    metadata: {
      ...(input.chatId ? { chat_id: input.chatId } : {}),
      direct: input.isPipeModel === true,
      features,
      files,
      ...(input.filterIds?.length ? { filter_ids: input.filterIds } : {}),
      interface: "open-webui",
      ...(input.assistantMessageId ? { message_id: input.assistantMessageId } : {}),
      ...(input.modelItem ? { model: input.modelItem } : {}),
      ...(input.sessionId ? { session_id: input.sessionId } : {}),
      tool_ids: input.toolIds?.length ? input.toolIds : null,
      tool_servers: toolServers,
      type: "user_response",
      variables
    },
    stream_options: {
      include_usage: true
    },
    background_tasks: input.backgroundTasks ?? {},
    tool_servers: toolServers
  };

  if (functionCalling !== undefined) {
    payload.metadata.function_calling = functionCalling;
  }

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
