import {
  type BuildCompletionPayloadInput,
  type ChatCompletionRequest,
  defaultFeatureFlags
} from "./types";

export function buildCompletionPayload(
  input: BuildCompletionPayloadInput
): ChatCompletionRequest {
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
