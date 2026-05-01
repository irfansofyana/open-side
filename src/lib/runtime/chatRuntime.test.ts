import {
  listRecentChats,
  loadChatForDisplay,
  sendPersistedMessage,
  sendStreamingMessage
} from "./chatRuntime";
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
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
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
        content: "persisted ok",
        done: true
      })
    })
  );
  expect(client.getChat).toHaveBeenCalledTimes(3);
  expect(contentChunks).toEqual(["persisted ok"]);
});

test("sendPersistedMessage continues the active chat instead of creating a new one", async () => {
  const activeChat: ChatTree = {
    id: "chat-1",
    title: "Existing chat",
    currentId: "assistant-prev",
    messages: {
      "user-prev": { id: "user-prev", role: "user", content: "Hello" },
      "assistant-prev": {
        id: "assistant-prev",
        role: "assistant",
        content: "Hi there"
      }
    },
    raw: {
      chat: {
        title: "Existing chat",
        models: ["openrouter/fast"],
        currentId: "assistant-prev",
        messages: [
          {
            id: "user-prev",
            role: "user",
            content: "Hello",
            timestamp: 1714528700,
            models: ["openrouter/fast"],
            childrenIds: ["assistant-prev"]
          },
          {
            id: "assistant-prev",
            parentId: "user-prev",
            role: "assistant",
            content: "Hi there",
            timestamp: 1714528701,
            childrenIds: [],
            model: "openrouter/fast",
            modelName: "openrouter/fast",
            modelIdx: 0,
            done: true
          }
        ],
        history: {
          currentId: "assistant-prev",
          messages: {
            "user-prev": {
              id: "user-prev",
              role: "user",
              content: "Hello",
              childrenIds: ["assistant-prev"]
            },
            "assistant-prev": {
              id: "assistant-prev",
              parentId: "user-prev",
              role: "assistant",
              content: "Hi there",
              childrenIds: []
            }
          }
        }
      }
    }
  };
  const refreshedChat: ChatTree = {
    id: "chat-1",
    title: "Existing chat",
    currentId: "assistant-next",
    messages: {
      "assistant-next": {
        id: "assistant-next",
        role: "assistant",
        content: "next answer"
      }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "new-chat" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () =>
      createStream(['data: {"choices":[{"delta":{"content":"next answer"}}]}\n\n'])
    ),
    getChat: vi.fn(async () => refreshedChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };

  await expect(
    sendPersistedMessage({
      activeChat,
      client,
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-next")
        .mockReturnValueOnce("assistant-next")
        .mockReturnValueOnce("session-1"),
      modelId: "openrouter/fast",
      modelItem: { id: "openrouter/fast" },
      now: () => 1714528800000,
      prompt: "Continue please"
    })
  ).resolves.toEqual({
    assistantText: "next answer",
    chatId: "chat-1",
    refreshedChat
  });

  expect(client.createChat).not.toHaveBeenCalled();
  expect(client.updateChat).toHaveBeenCalledWith("chat-1", {
    chat: {
      title: "Existing chat",
      models: ["openrouter/fast"],
      currentId: "assistant-next",
      messages: [
        expect.objectContaining({ id: "user-prev" }),
        expect.objectContaining({ id: "assistant-prev", childrenIds: ["user-next"] }),
        expect.objectContaining({
          id: "user-next",
          parentId: "assistant-prev",
          childrenIds: ["assistant-next"]
        }),
        expect.objectContaining({ id: "assistant-next", parentId: "user-next" })
      ],
      history: {
        currentId: "assistant-next",
        messages: {
          "user-prev": expect.objectContaining({ id: "user-prev" }),
          "assistant-prev": expect.objectContaining({ childrenIds: ["user-next"] }),
          "user-next": expect.objectContaining({
            parentId: "assistant-prev",
            childrenIds: ["assistant-next"]
          }),
          "assistant-next": expect.objectContaining({ parentId: "user-next" })
        }
      }
    }
  });
  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({
      chat_id: "chat-1",
      id: "assistant-next",
      parent_id: "user-next",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "Continue please" }
      ]
    })
  );
});

test("listRecentChats fetches the first server-side chat page with pinned chats included", async () => {
  const chats = [
    { id: "chat-1", title: "First chat", updatedAt: 1714528800 },
    { id: "chat-2", title: "Second chat", pinned: true }
  ];
  const client = {
    getChats: vi.fn(async () => chats)
  };

  await expect(listRecentChats({ client })).resolves.toEqual(chats);

  expect(client.getChats).toHaveBeenCalledWith({ page: 1, includePinned: true });
});

test("loadChatForDisplay loads a chat and returns ordered user and assistant messages", async () => {
  const chat: ChatTree = {
    id: "chat-1",
    title: "Loaded chat",
    currentId: "assistant-2",
    messages: {},
    raw: {
      chat: {
        messages: [
          { id: "user-1", role: "user", content: "Hello", timestamp: 1 },
          { id: "assistant-1", role: "assistant", content: "Hi", timestamp: 2 },
          { id: "user-2", role: "user", content: "Follow up", timestamp: 3 },
          { id: "assistant-2", role: "assistant", content: "Answer", timestamp: 4 },
          { id: "system-1", role: "system", content: "Hidden" }
        ]
      }
    }
  };
  const client = {
    getChat: vi.fn(async () => chat)
  };

  await expect(loadChatForDisplay({ chatId: "chat-1", client })).resolves.toEqual({
    chat,
    messages: [
      { id: "user-1", role: "user", content: "Hello" },
      { id: "assistant-1", role: "assistant", content: "Hi" },
      { id: "user-2", role: "user", content: "Follow up" },
      { id: "assistant-2", role: "assistant", content: "Answer" }
    ]
  });
  expect(client.getChat).toHaveBeenCalledWith("chat-1");
});
