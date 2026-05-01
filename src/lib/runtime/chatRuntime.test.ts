import { sendPersistedMessage, sendStreamingMessage } from "./chatRuntime";
import type { ChatCompletionRequest, ChatTree } from "../openwebui/types";

const createStream = (chunks: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

test("sendStreamingMessage builds payload, streams content, and returns assistant text", async () => {
  let sentPayload: ChatCompletionRequest | undefined;
  const client = {
    streamChatCompletion: vi.fn(async (payload: ChatCompletionRequest) => {
      sentPayload = payload;
      return createStream([
        'data: {"choices":[{"delta":{"content":"smoke"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"-ok"}}]}\n\n',
        "data: [DONE]\n\n"
      ]);
    })
  };
  const contentChunks: string[] = [];
  const eventTypes: string[] = [];

  await expect(
    sendStreamingMessage({
      client,
      modelId: "openrouter.anthropic/claude-haiku-4.5",
      prompt: "Say smoke-ok",
      previousMessages: [{ role: "system", content: "Be concise" }],
      onContent: (content) => contentChunks.push(content),
      onEvent: (event) => eventTypes.push(event.type)
    })
  ).resolves.toEqual({
    assistantText: "smoke-ok"
  });

  expect(sentPayload).toMatchObject({
    stream: true,
    model: "openrouter.anthropic/claude-haiku-4.5",
    messages: [
      { role: "system", content: "Be concise" },
      { role: "user", content: "Say smoke-ok" }
    ],
    features: {
      web_search: false,
      image_generation: false,
      code_interpreter: false,
      memory: false
    }
  });
  expect(contentChunks).toEqual(["smoke", "-ok"]);
  expect(eventTypes).toEqual(["content", "content", "done"]);
});

test("sendStreamingMessage forwards payload options and throws on stream error event", async () => {
  const client = {
    streamChatCompletion: vi.fn(async () =>
      createStream(['data: {"error":"model unavailable"}\n\n'])
    )
  };

  await expect(
    sendStreamingMessage({
      client,
      modelId: "llama",
      prompt: "hello",
      features: { web_search: true },
      toolIds: ["tool-1"],
      filterIds: ["filter-1"],
      modelItem: { id: "llama" }
    })
  ).rejects.toThrow("model unavailable");

  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({
      model: "llama",
      tool_ids: ["tool-1"],
      filter_ids: ["filter-1"],
      model_item: { id: "llama" },
      features: expect.objectContaining({ web_search: true })
    })
  );
});

test("sendPersistedMessage creates linked chat, polls persisted text when stream is empty, finalizes, and refetches", async () => {
  const chatDetail: ChatTree = {
    id: "chat-1",
    title: "Extension smoke",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "persisted ok" }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createStream([])),
    getChat: vi
      .fn()
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Extension smoke",
        messages: {
          "assistant-1": { id: "assistant-1", role: "assistant", content: "" }
        }
      })
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Extension smoke",
        messages: {},
        raw: {
          chat: {
            history: {
              messages: {
                "assistant-1": {
                  id: "assistant-1",
                  role: "assistant",
                  content: "persisted ok"
                }
              }
            }
          }
        }
      })
      .mockResolvedValueOnce(chatDetail),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];
  const delay = vi.fn(async () => undefined);

  await expect(
    sendPersistedMessage({
      client,
      delay,
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-1")
        .mockReturnValueOnce("assistant-1")
        .mockReturnValueOnce("session-1"),
      modelId: "openrouter/fast",
      modelItem: { id: "openrouter/fast", name: "Fast" },
      now: () => 1714528800000,
      pollIntervalMs: 25,
      pollMaxAttempts: 3,
      prompt: "Say persisted ok",
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: "persisted ok",
    chatId: "chat-1",
    refreshedChat: chatDetail
  });

  expect(client.createChat).toHaveBeenCalledWith({
    chat: {
      title: "Say persisted ok",
      models: ["openrouter/fast"],
      currentId: "assistant-1",
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Say persisted ok",
          timestamp: 1714528800,
          models: ["openrouter/fast"],
          childrenIds: ["assistant-1"]
        },
        {
          id: "assistant-1",
          parentId: "user-1",
          role: "assistant",
          content: "",
          timestamp: 1714528801,
          childrenIds: [],
          model: "openrouter/fast",
          modelName: "openrouter/fast",
          modelIdx: 0,
          done: false
        }
      ],
      history: {
        currentId: "assistant-1",
        messages: {
          "user-1": expect.objectContaining({ childrenIds: ["assistant-1"] }),
          "assistant-1": expect.objectContaining({ parentId: "user-1" })
        }
      }
    }
  });
  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({
      chat_id: "chat-1",
      id: "assistant-1",
      session_id: "session-1",
      parent_id: "user-1",
      user_message: expect.objectContaining({ id: "user-1" }),
      model_item: { id: "openrouter/fast", name: "Fast" },
      background_tasks: {
        title_generation: true,
        tags_generation: false,
        follow_up_generation: false
      }
    })
  );
  expect(delay).toHaveBeenCalledWith(25);
  expect(client.completeChat).toHaveBeenCalledWith(
    expect.objectContaining({
      chat_id: "chat-1",
      id: "assistant-1",
      session_id: "session-1",
      model: "openrouter/fast",
      message: expect.objectContaining({
        id: "assistant-1",
        content: "persisted ok"
      })
    })
  );
  expect(client.getChat).toHaveBeenCalledTimes(3);
  expect(contentChunks).toEqual(["persisted ok"]);
});
