import { buildCompletionPayload } from "./requestBuilders";

test("buildCompletionPayload creates the Open WebUI chat completion shape", () => {
  const payload = buildCompletionPayload({
    modelId: "openrouter.anthropic/claude-haiku-4.5",
    messages: [{ role: "user", content: "hello" }],
    features: { web_search: true },
    modelItem: { id: "openrouter.anthropic/claude-haiku-4.5" },
    toolIds: ["tool-1"],
    filterIds: ["filter-1"],
    userMessage: { id: "user-message-1", role: "user", content: "hello" },
    chatId: "chat-1",
    sessionId: "session-1",
    assistantMessageId: "assistant-message-1",
    parentId: "parent-1"
  });

  expect(payload).toEqual({
    stream: true,
    model: "openrouter.anthropic/claude-haiku-4.5",
    messages: [{ role: "user", content: "hello" }],
    chat_id: "chat-1",
    session_id: "session-1",
    id: "assistant-message-1",
    parent_id: "parent-1",
    user_message: { id: "user-message-1", role: "user", content: "hello" },
    model_item: { id: "openrouter.anthropic/claude-haiku-4.5" },
    tool_ids: ["tool-1"],
    filter_ids: ["filter-1"],
    features: {
      web_search: true,
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
  });
});

test("buildCompletionPayload omits empty optional arrays and pipe chat identifiers", () => {
  const payload = buildCompletionPayload({
    modelId: "pipe-model",
    messages: [{ role: "user", content: "hello" }],
    toolIds: [],
    filterIds: [],
    chatId: "chat-1",
    sessionId: "session-1",
    assistantMessageId: "assistant-message-1",
    isPipeModel: true
  });

  expect(payload.tool_ids).toBeUndefined();
  expect(payload.filter_ids).toBeUndefined();
  expect(payload.chat_id).toBeUndefined();
  expect(payload.session_id).toBeUndefined();
  expect(payload.id).toBeUndefined();
});

test("buildCompletionPayload keeps variables shared with metadata", () => {
  const variables = { selectedText: "hello" };
  const payload = buildCompletionPayload({
    modelId: "llama",
    messages: [{ role: "user", content: "hello" }],
    variables
  });

  expect(payload.variables).toBe(variables);
  expect(payload.metadata.variables).toBe(variables);
});
