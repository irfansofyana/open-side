import {
  listRecentChats,
  loadChatForDisplay,
  sendDirectPersistedMessage,
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

const createPendingStream = (): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start() {
      // Keep the HTTP body open so realtime or polling can win the race.
    }
  });

const createControlledStream = (): {
  close: () => void;
  enqueue: (chunk: string) => void;
  stream: ReadableStream<Uint8Array>;
} => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    }
  });

  return {
    close: () => streamController?.close(),
    enqueue: (chunk) => streamController?.enqueue(encoder.encode(chunk)),
    stream
  };
};

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

test("sendStreamingMessage preserves reasoning chunks in the assistant text stream", async () => {
  const client = {
    streamChatCompletion: vi.fn(async () =>
      createStream([
        'data: {"choices":[{"delta":{"reasoning_content":"I should think"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Final"}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    )
  };
  const contentChunks: string[] = [];
  const eventTypes: string[] = [];

  await expect(
    sendStreamingMessage({
      client,
      modelId: "deepseek-reasoner",
      prompt: "Think",
      onContent: (content) => contentChunks.push(content),
      onEvent: (event) => eventTypes.push(event.type)
    })
  ).resolves.toEqual({
    assistantText: "<think>I should think</think>\n\nFinal"
  });

  expect(contentChunks).toEqual(["<think>", "I should think", "</think>\n\n", "Final"]);
  expect(eventTypes).toEqual(["reasoning", "content", "done"]);
});

test("sendStreamingMessage returns citation sources from Open WebUI events", async () => {
  const client = {
    streamChatCompletion: vi.fn(async () =>
      createStream([
        'data: {"type":"citation","data":{"document":["Reuters says Purbaya was appointed."],"metadata":[{"source":"Reuters","url":"https://example.com/reuters"}],"source":{"name":"Reuters","url":"https://example.com/reuters"}}}\n\n',
        'data: {"choices":[{"delta":{"content":"The minister is Purbaya [1]."}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    )
  };
  const eventTypes: string[] = [];

  await expect(
    sendStreamingMessage({
      client,
      modelId: "openrouter.anthropic/claude-haiku-4.5",
      prompt: "Who is the minister?",
      onEvent: (event) => eventTypes.push(event.type)
    })
  ).resolves.toEqual({
    assistantText: "The minister is Purbaya [1].",
    sources: [
      {
        documents: ["Reuters says Purbaya was appointed."],
        index: 1,
        metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
        name: "Reuters",
        url: "https://example.com/reuters"
      }
    ]
  });
  expect(eventTypes).toEqual(["citation", "content", "done"]);
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

test("sendDirectPersistedMessage streams direct HTTP chunks before creating server chat", async () => {
  const controlledStream = createControlledStream();
  const refreshedChat: ChatTree = {
    id: "chat-1",
    title: "Direct stream",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello world" }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async (_payload: ChatCompletionRequest) => controlledStream.stream),
    getChat: vi.fn(async () => refreshedChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];
  const diagnostics = { log: vi.fn() };

  const sendPromise = sendDirectPersistedMessage({
    client,
    diagnostics,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    prompt: "Say hello",
    onContent: (content) => contentChunks.push(content)
  });

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalled();
  });
  controlledStream.enqueue('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');

  await vi.waitFor(() => {
    expect(contentChunks).toEqual(["Hello"]);
  });
  expect(client.createChat).not.toHaveBeenCalled();

  controlledStream.enqueue('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
  controlledStream.enqueue("data: [DONE]\n\n");
  controlledStream.close();

  await expect(sendPromise).resolves.toEqual({
    assistantText: "Hello world",
    chatId: "chat-1",
    refreshedChat
  });
  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.not.objectContaining({
      chat_id: expect.anything(),
      id: expect.anything(),
      session_id: expect.anything()
    })
  );
  const directPayload = vi.mocked(client.streamChatCompletion).mock.calls[0]?.[0];
  expect(directPayload?.variables).toEqual(
    expect.objectContaining({
      "{{CURRENT_DATE}}": expect.any(String),
      "{{CURRENT_DATETIME}}": expect.any(String),
      "{{CURRENT_TIME}}": expect.any(String),
      "{{CURRENT_TIMEZONE}}": expect.any(String),
      "{{CURRENT_WEEKDAY}}": expect.any(String)
    })
  );
  expect(directPayload?.metadata).toEqual(
    expect.objectContaining({
      interface: "open-webui",
      variables: directPayload?.variables
    })
  );
  expect(client.createChat).toHaveBeenCalledWith({
    chat: expect.objectContaining({
      currentId: "assistant-1",
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "user-1", content: "Say hello" }),
        expect.objectContaining({
          id: "assistant-1",
          content: "Hello world",
          done: true
        })
      ])
    })
  });
  expect(client.completeChat).toHaveBeenCalledWith(
    expect.objectContaining({
      chat_id: "chat-1",
      id: "assistant-1",
      session_id: "session-1",
      message: expect.objectContaining({
        content: "Hello world",
        done: true
      })
    })
  );
  expect(diagnostics.log).toHaveBeenCalledWith("chat.direct.first_text", {
    source: "http"
  });
  expect(diagnostics.log).toHaveBeenCalledWith("chat.direct.persist.start", {
    assistantChars: 11,
    activeChat: false
  });
});

test("sendDirectPersistedMessage continues an active chat after direct streaming finishes", async () => {
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
    sendDirectPersistedMessage({
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
  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
        { role: "user", content: "Continue please" }
      ]
    })
  );
  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.not.objectContaining({
      chat_id: expect.anything(),
      id: expect.anything(),
      session_id: expect.anything()
    })
  );
  expect(client.updateChat).toHaveBeenCalledWith("chat-1", {
    chat: expect.objectContaining({
      currentId: "assistant-next",
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "user-next", parentId: "assistant-prev" }),
        expect.objectContaining({
          id: "assistant-next",
          content: "next answer",
          done: true,
          parentId: "user-next"
        })
      ]),
      history: expect.objectContaining({
        currentId: "assistant-next",
        messages: expect.objectContaining({
          "assistant-next": expect.objectContaining({
            content: "next answer",
            done: true,
            parentId: "user-next"
          })
        })
      })
    })
  });
});

test("sendDirectPersistedMessage preserves reasoning-only direct responses without throwing", async () => {
  const refreshedChat: ChatTree = {
    id: "chat-1",
    title: "Reasoning only",
    currentId: "assistant-1",
    messages: {
      "assistant-1": {
        id: "assistant-1",
        role: "assistant",
        content: "<think>I know the current president.</think>\n\n"
      }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () =>
      createStream([
        'data: {"choices":[{"delta":{"reasoning_content":"I know the current president."}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    ),
    getChat: vi.fn(async () => refreshedChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];

  await expect(
    sendDirectPersistedMessage({
      client,
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-1")
        .mockReturnValueOnce("assistant-1")
        .mockReturnValueOnce("session-1"),
      modelId: "minimax-m2.7:cloud",
      modelItem: { id: "minimax-m2.7:cloud" },
      now: () => 1714528800000,
      prompt: "siapa presiden indonesia sekarang",
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: "<think>I know the current president.</think>\n\n",
    chatId: "chat-1",
    refreshedChat
  });

  expect(contentChunks).toEqual(["<think>", "I know the current president.", "</think>\n\n"]);
  expect(client.createChat).toHaveBeenCalledWith({
    chat: expect.objectContaining({
      messages: expect.arrayContaining([
        expect.objectContaining({
          id: "assistant-1",
          content: "<think>I know the current president.</think>\n\n",
          done: true
        })
      ])
    })
  });
});

test("sendDirectPersistedMessage aborts direct HTTP streaming when the response stalls", async () => {
  const controlledStream = createControlledStream();
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => controlledStream.stream),
    getChat: vi.fn(async () => ({
      id: "chat-1",
      title: "Direct stream",
      messages: {}
    })),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];

  const sendPromise = sendDirectPersistedMessage({
    client,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast" },
    now: () => 1714528800000,
    prompt: "Think with tools",
    streamIdleTimeoutMs: 5,
    onContent: (content) => contentChunks.push(content)
  });
  const sendError = sendPromise.catch((error: unknown) => error);

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalled();
  });
  controlledStream.enqueue('data: {"choices":[{"delta":{"content":"Let me check"}}]}\n\n');

  await vi.waitFor(() => {
    expect(contentChunks).toEqual(["Let me check"]);
  });
  await expect(sendError).resolves.toEqual(
    expect.objectContaining({ message: "Open WebUI direct stream stalled" })
  );
  expect(client.createChat).not.toHaveBeenCalled();
  expect(client.completeChat).not.toHaveBeenCalled();
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
    streamChatCompletion: vi.fn(async (_payload: ChatCompletionRequest) => createStream([])),
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
      .mockResolvedValueOnce(chatDetail)
      .mockResolvedValueOnce(chatDetail),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];
  const delay = vi.fn(async (_ms: number) => undefined);

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
  const persistedPayload = vi.mocked(client.streamChatCompletion).mock.calls[0]?.[0];
  expect(persistedPayload?.variables).toEqual(
    expect.objectContaining({
      "{{CURRENT_DATE}}": expect.any(String),
      "{{CURRENT_DATETIME}}": expect.any(String),
      "{{CURRENT_TIME}}": expect.any(String),
      "{{CURRENT_TIMEZONE}}": expect.any(String),
      "{{CURRENT_WEEKDAY}}": expect.any(String)
    })
  );
  expect(persistedPayload?.metadata).toEqual(
    expect.objectContaining({
      interface: "open-webui",
      variables: persistedPayload?.variables
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
  expect(client.getChat).toHaveBeenCalledTimes(4);
  expect(contentChunks).toEqual(["persisted ok"]);
});

test("sendPersistedMessage streams persisted polling deltas before completion finishes", async () => {
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Extension smoke",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello streaming world" }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(
      async () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            setTimeout(() => controller.close(), 40);
          }
        })
    ),
    getChat: vi
      .fn()
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Extension smoke",
        messages: {
          "assistant-1": {
            id: "assistant-1",
            role: "assistant",
            content: "Hello"
          }
        }
      })
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Extension smoke",
        messages: {
          "assistant-1": {
            id: "assistant-1",
            role: "assistant",
            content: "Hello streaming"
          }
        }
      })
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Extension smoke",
        messages: {
          "assistant-1": {
            id: "assistant-1",
            role: "assistant",
            content: "Hello streaming world"
          }
        }
      })
      .mockResolvedValueOnce(finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];
  const delay = vi.fn(async (_ms: number) => undefined);

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
      pollIntervalMs: 5,
      pollMaxAttempts: 5,
      prompt: "Say hello",
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: "Hello streaming world",
    chatId: "chat-1",
    refreshedChat: finalChat
  });

  expect(contentChunks).toEqual(["Hello", " streaming", " world"]);
  expect(delay).toHaveBeenCalledWith(5);
});

test("sendPersistedMessage streams realtime socket deltas without waiting for the HTTP trigger", async () => {
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Realtime",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello world" }
    }
  };
  let realtimeHandler:
    | ((event: {
        chat_id?: string;
        message_id?: string;
        data?: { type?: string; data?: unknown };
      }) => void)
    | undefined;
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    triggerChatCompletion: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    getChat: vi.fn(async () => finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const realtimeClient = {
    connect: vi.fn(async () => ({ sessionId: "socket-1" })),
    disconnect: vi.fn(),
    onEvent: vi.fn((handler) => {
      realtimeHandler = handler;

      return vi.fn();
    })
  };
  const contentChunks: string[] = [];

  const sendPromise = sendPersistedMessage({
    client,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("fallback-session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    prompt: "Say hello",
    realtimeClient,
    onContent: (content) => contentChunks.push(content)
  });

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: "socket-1" })
    );
  });
  expect(client.triggerChatCompletion).not.toHaveBeenCalled();
  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({ session_id: "socket-1" })
  );

  realtimeHandler?.({
    chat_id: "chat-1",
    message_id: "assistant-1",
    data: { type: "chat:message:delta", data: { content: "Hello" } }
  });
  expect(contentChunks).toEqual(["Hello"]);

  realtimeHandler?.({
    chat_id: "chat-1",
    message_id: "assistant-1",
    data: { type: "chat:completion", data: { content: "Hello world", done: true } }
  });
  expect(contentChunks).toEqual(["Hello", " world"]);

  await expect(sendPromise).resolves.toEqual({
    assistantText: "Hello world",
    chatId: "chat-1",
    refreshedChat: finalChat
  });
  expect(realtimeClient.disconnect).toHaveBeenCalled();
});

test("sendPersistedMessage polls quickly when realtime connects but stays silent", async () => {
  const firstChat: ChatTree = {
    id: "chat-1",
    title: "Realtime fallback",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello", done: false }
    }
  };
  const secondChat: ChatTree = {
    id: "chat-1",
    title: "Realtime fallback",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello world", done: true }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    getChat: vi
      .fn()
      .mockResolvedValueOnce(firstChat)
      .mockResolvedValueOnce(secondChat)
      .mockResolvedValueOnce(secondChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const realtimeClient = {
    connect: vi.fn(async () => ({ sessionId: "socket-1" })),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => vi.fn())
  };
  const contentChunks: string[] = [];
  const delay = vi.fn(async (_ms: number) => undefined);

  await expect(
    sendPersistedMessage({
      client,
      delay,
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-1")
        .mockReturnValueOnce("assistant-1")
        .mockReturnValueOnce("fallback-session-1"),
      modelId: "openrouter/fast",
      modelItem: { id: "openrouter/fast", name: "Fast" },
      now: () => 1714528800000,
      prompt: "Say hello",
      realtimeClient,
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: "Hello world",
    chatId: "chat-1",
    refreshedChat: secondChat
  });

  expect(delay.mock.calls[0]?.[0]).toBe(750);
  expect(contentChunks).toEqual(["Hello", " world"]);
  expect(realtimeClient.disconnect).toHaveBeenCalled();
});

test("sendPersistedMessage logs when polling becomes the first content source", async () => {
  const firstChat: ChatTree = {
    id: "chat-1",
    title: "Realtime fallback",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello", done: false }
    }
  };
  const secondChat: ChatTree = {
    id: "chat-1",
    title: "Realtime fallback",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello world", done: true }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    getChat: vi
      .fn()
      .mockResolvedValueOnce(firstChat)
      .mockResolvedValueOnce(secondChat)
      .mockResolvedValueOnce(secondChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const realtimeClient = {
    connect: vi.fn(async () => ({ sessionId: "socket-1" })),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => vi.fn())
  };
  const diagnostics = { log: vi.fn() };

  await sendPersistedMessage({
    client,
    delay: vi.fn(async (_ms: number) => undefined),
    diagnostics,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("fallback-session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    prompt: "Say hello",
    realtimeClient,
    onContent: vi.fn()
  });

  expect(diagnostics.log).toHaveBeenCalledWith("chat.send.start", {
    activeChat: false,
    modelId: "openrouter/fast",
    promptLength: 9
  });
  expect(diagnostics.log).toHaveBeenCalledWith("chat.completion.request.start", {
    assistantMessageId: "assistant-1",
    chatId: "chat-1",
    modelId: "openrouter/fast",
    sessionId: "socket-1"
  });
  expect(diagnostics.log).toHaveBeenCalledWith("chat.poll.first_content", {
    assistantMessageId: "assistant-1",
    attempt: 1,
    chatId: "chat-1",
    contentLength: 5
  });
  expect(diagnostics.log).toHaveBeenCalledWith("chat.stream.first_text", {
    source: "poll"
  });
  expect(diagnostics.log).toHaveBeenCalledWith("chat.send.done", {
    assistantChars: 11,
    chatId: "chat-1",
    contentSource: "poll"
  });
  expect(JSON.stringify(diagnostics.log.mock.calls)).not.toContain("Say hello");
});

test("sendPersistedMessage streams the completion response body when trigger helper exists", async () => {
  const emptyChat: ChatTree = {
    id: "chat-1",
    title: "HTTP stream",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "" }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () =>
      createStream([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":" live"}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    ),
    triggerChatCompletion: vi.fn(async () => ({ ok: true })),
    getChat: vi.fn(async () => emptyChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];

  await expect(
    sendPersistedMessage({
      client,
      delay: vi.fn(async () => undefined),
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-1")
        .mockReturnValueOnce("assistant-1")
        .mockReturnValueOnce("fallback-session-1"),
      modelId: "openrouter/fast",
      modelItem: { id: "openrouter/fast", name: "Fast" },
      now: () => 1714528800000,
      pollIntervalMs: 5,
      pollMaxAttempts: 1,
      prompt: "Say hello",
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: "Hello live",
    chatId: "chat-1",
    refreshedChat: emptyChat
  });

  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({ session_id: "fallback-session-1" })
  );
  expect(client.triggerChatCompletion).not.toHaveBeenCalled();
  expect(contentChunks).toEqual(["Hello", " live"]);
});

test("sendPersistedMessage keeps polling when the live stream only produced reasoning", async () => {
  const controlledStream = createControlledStream();
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Reasoning",
    currentId: "assistant-1",
    messages: {
      "assistant-1": {
        id: "assistant-1",
        role: "assistant",
        content: "Hari ini tanggal 3 Mei 2026.",
        done: true
      }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => controlledStream.stream),
    triggerChatCompletion: vi.fn(async () => ({ ok: true })),
    getChat: vi.fn(async () => finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];
  const delayResolvers: Array<() => void> = [];
  const delay = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        delayResolvers.push(resolve);
      })
  );

  const sendPromise = sendPersistedMessage({
    client,
    delay,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("fallback-session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    pollIntervalMs: 5,
    pollMaxAttempts: 2,
    prompt: "Hari ini tanggal berapa?",
    onContent: (content) => contentChunks.push(content)
  });

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalled();
  });
  controlledStream.enqueue(
    'data: {"choices":[{"delta":{"reasoning_content":"I need to check the current timestamp."}}]}\n\n'
  );
  await vi.waitFor(() => {
    expect(contentChunks).toEqual(["<think>", "I need to check the current timestamp."]);
  });
  controlledStream.enqueue("data: [DONE]\n\n");
  controlledStream.close();

  await expect(sendPromise).resolves.toEqual({
    assistantText: "Hari ini tanggal 3 Mei 2026.",
    chatId: "chat-1",
    refreshedChat: finalChat
  });

  expect(contentChunks).toEqual([
    "<think>",
    "I need to check the current timestamp.",
    "</think>\n\n",
    "Hari ini tanggal 3 Mei 2026."
  ]);
});

test("sendPersistedMessage uses persisted tool output as the source of truth", async () => {
  const controlledStream = createControlledStream();
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Tool response",
    currentId: "assistant-1",
    messages: {
      "assistant-1": {
        id: "assistant-1",
        role: "assistant",
        content: "Final tool answer.",
        done: true
      }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => controlledStream.stream),
    triggerChatCompletion: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    getChat: vi.fn(async () => finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];
  const delayResolvers: Array<() => void> = [];
  const delay = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        delayResolvers.push(resolve);
      })
  );

  const sendPromise = sendPersistedMessage({
    client,
    delay,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("fallback-session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    pollIntervalMs: 5,
    pollMaxAttempts: 3,
    prompt: "Use web search",
    toolIds: ["web_search"],
    onContent: (content) => contentChunks.push(content)
  });
  const observedSend = sendPromise.catch((error: unknown) => error);

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalled();
  });
  controlledStream.enqueue('data: {"choices":[{"delta":{"content":"I\\u0027ll search for information."}}]}\n\n');
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(contentChunks).toEqual([]);
  delayResolvers.shift()?.();

  const result = await Promise.race([
    observedSend,
    new Promise<"timed-out">((resolve) => {
      setTimeout(() => resolve("timed-out"), 50);
    })
  ]);
  controlledStream.close();

  expect(result).toEqual({
    assistantText: "Final tool answer.",
    chatId: "chat-1",
    refreshedChat: finalChat
  });
  expect(contentChunks).toEqual(["Final tool answer."]);
});

test("sendPersistedMessage keeps polling tool runs when persisted content is reasoning-only", async () => {
  const reasoningOnly =
    "<think>The user asks today's date. I can use get_current_timestamp.</think>";
  const finalText = `${reasoningOnly}\n\nHari ini tanggal 3 Mei 2026.`;
  const reasoningChat: ChatTree = {
    id: "chat-1",
    title: "Timestamp",
    currentId: "assistant-1",
    messages: {
      "assistant-1": {
        id: "assistant-1",
        role: "assistant",
        content: reasoningOnly,
        done: false
      }
    }
  };
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Timestamp",
    currentId: "assistant-1",
    messages: {
      "assistant-1": {
        id: "assistant-1",
        role: "assistant",
        content: finalText,
        done: true
      }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    triggerChatCompletion: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    getChat: vi
      .fn()
      .mockResolvedValueOnce(reasoningChat)
      .mockResolvedValueOnce(reasoningChat)
      .mockResolvedValueOnce(reasoningChat)
      .mockResolvedValue(finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const contentChunks: string[] = [];

  await expect(
    sendPersistedMessage({
      client,
      delay: vi.fn(async () => undefined),
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-1")
        .mockReturnValueOnce("assistant-1")
        .mockReturnValueOnce("fallback-session-1"),
      modelId: "minimax-m2.7:cloud",
      modelItem: { id: "minimax-m2.7:cloud" },
      now: () => 1777755600000,
      pollIntervalMs: 5,
      pollMaxAttempts: 5,
      prompt: "hari ini tanggal berapa",
      toolIds: ["get_current_timestamp"],
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: finalText,
    chatId: "chat-1",
    refreshedChat: finalChat
  });

  expect(client.getChat).toHaveBeenCalledTimes(5);
  expect(contentChunks.join("")).toBe(finalText);
});

test("sendPersistedMessage streams flat realtime socket deltas instead of waiting for polling snapshots", async () => {
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Realtime",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Hello from realtime" }
    }
  };
  let realtimeHandler:
    | ((event: {
        chat_id?: string;
        data?: unknown;
        message_id?: string;
        session_id?: string;
        type?: string;
      }) => void)
    | undefined;
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    triggerChatCompletion: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    getChat: vi
      .fn()
      .mockResolvedValueOnce({
        id: "chat-1",
        title: "Realtime",
        messages: {
          "assistant-1": {
            id: "assistant-1",
            role: "assistant",
            content: "Hello from a polling snapshot that should not replace realtime"
          }
        }
      })
      .mockResolvedValue(finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const realtimeClient = {
    connect: vi.fn(async () => ({ sessionId: "socket-1" })),
    disconnect: vi.fn(),
    onEvent: vi.fn((handler) => {
      realtimeHandler = handler;

      return vi.fn();
    })
  };
  const contentChunks: string[] = [];
  const delayResolvers: Array<() => void> = [];
  const delay = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        delayResolvers.push(resolve);
      })
  );

  const sendPromise = sendPersistedMessage({
    client,
    delay,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("fallback-session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    pollIntervalMs: 5,
    pollMaxAttempts: 3,
    prompt: "Say hello",
    realtimeClient,
    onContent: (content) => contentChunks.push(content)
  });

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalled();
  });
  expect(client.triggerChatCompletion).not.toHaveBeenCalled();

  realtimeHandler?.({
    chat_id: "chat-1",
    message_id: "assistant-1",
    session_id: "socket-1",
    type: "event:message:delta",
    data: { content: "Hello" }
  });
  expect(contentChunks).toEqual(["Hello"]);

  delayResolvers.shift()?.();
  await vi.waitFor(() => {
    expect(client.getChat).toHaveBeenCalledTimes(1);
  });
  expect(contentChunks).toEqual(["Hello"]);

  realtimeHandler?.({
    chat_id: "chat-1",
    message_id: "assistant-1",
    session_id: "socket-1",
    type: "chat:completion",
    data: { content: "Hello from realtime", done: true }
  });
  delayResolvers.shift()?.();

  await expect(sendPromise).resolves.toEqual({
    assistantText: "Hello from realtime",
    chatId: "chat-1",
    refreshedChat: finalChat
  });
  expect(contentChunks).toEqual(["Hello", " from realtime"]);
});

test("sendPersistedMessage accepts realtime events by matching session id even when chat id differs", async () => {
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Realtime",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Session routed" }
    }
  };
  let realtimeHandler:
    | ((event: {
        chat_id?: string;
        data?: unknown;
        message_id?: string;
        session_id?: string;
        type?: string;
      }) => void)
    | undefined;
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    triggerChatCompletion: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    getChat: vi.fn(async () => finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const realtimeClient = {
    connect: vi.fn(async () => ({ sessionId: "socket-1" })),
    disconnect: vi.fn(),
    onEvent: vi.fn((handler) => {
      realtimeHandler = handler;

      return vi.fn();
    })
  };
  const contentChunks: string[] = [];

  const sendPromise = sendPersistedMessage({
    client,
    idGenerator: vi
      .fn()
      .mockReturnValueOnce("user-1")
      .mockReturnValueOnce("assistant-1")
      .mockReturnValueOnce("fallback-session-1"),
    modelId: "openrouter/fast",
    modelItem: { id: "openrouter/fast", name: "Fast" },
    now: () => 1714528800000,
    prompt: "Say hello",
    realtimeClient,
    onContent: (content) => contentChunks.push(content)
  });

  await vi.waitFor(() => {
    expect(client.streamChatCompletion).toHaveBeenCalled();
  });
  expect(client.triggerChatCompletion).not.toHaveBeenCalled();

  realtimeHandler?.({
    chat_id: "local",
    message_id: "assistant-1",
    session_id: "socket-1",
    type: "chat:message:delta",
    data: { content: "Session" }
  });
  realtimeHandler?.({
    chat_id: "local",
    message_id: "assistant-1",
    session_id: "socket-1",
    type: "chat:completion",
    data: { content: "Session routed", done: true }
  });

  await expect(sendPromise).resolves.toEqual({
    assistantText: "Session routed",
    chatId: "chat-1",
    refreshedChat: finalChat
  });
  expect(contentChunks).toEqual(["Session", " routed"]);
});

test("sendPersistedMessage polls persisted content while HTTP trigger is still pending when realtime is unavailable", async () => {
  const finalChat: ChatTree = {
    id: "chat-1",
    title: "Polling",
    currentId: "assistant-1",
    messages: {
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Polled response" }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () => createPendingStream()),
    triggerChatCompletion: vi.fn(() => new Promise<Record<string, unknown>>(() => undefined)),
    getChat: vi.fn(async () => finalChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };
  const realtimeClient = {
    connect: vi.fn(async () => {
      throw new Error("socket blocked");
    }),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => vi.fn())
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
        .mockReturnValueOnce("fallback-session-1"),
      modelId: "openrouter/fast",
      modelItem: { id: "openrouter/fast", name: "Fast" },
      now: () => 1714528800000,
      pollIntervalMs: 5,
      pollMaxAttempts: 3,
      prompt: "Say hello",
      realtimeClient,
      onContent: (content) => contentChunks.push(content)
    })
  ).resolves.toEqual({
    assistantText: "Polled response",
    chatId: "chat-1",
    refreshedChat: finalChat
  });

  expect(client.streamChatCompletion).toHaveBeenCalledWith(
    expect.objectContaining({ session_id: "fallback-session-1" })
  );
  expect(client.triggerChatCompletion).not.toHaveBeenCalled();
  expect(contentChunks).toEqual(["Polled response"]);
  expect(delay).toHaveBeenCalledWith(5);
});

test("sendPersistedMessage carries citation sources into completion and result", async () => {
  const refreshedChat: ChatTree = {
    id: "chat-1",
    title: "Sources",
    currentId: "assistant-1",
    messages: {
      "assistant-1": {
        id: "assistant-1",
        role: "assistant",
        content: "The minister is Purbaya [1].",
        sources: [
          {
            document: ["Reuters says Purbaya was appointed."],
            metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
            source: { name: "Reuters", url: "https://example.com/reuters" }
          }
        ]
      }
    }
  };
  const client = {
    createChat: vi.fn(async () => ({ id: "chat-1" })),
    updateChat: vi.fn(async () => ({ id: "chat-1" })),
    streamChatCompletion: vi.fn(async () =>
      createStream([
        'data: {"type":"citation","data":{"document":["Reuters says Purbaya was appointed."],"metadata":[{"source":"Reuters","url":"https://example.com/reuters"}],"source":{"name":"Reuters","url":"https://example.com/reuters"}}}\n\n',
        'data: {"choices":[{"delta":{"content":"The minister is Purbaya [1]."}}]}\n\n',
        "data: [DONE]\n\n"
      ])
    ),
    getChat: vi.fn(async () => refreshedChat),
    completeChat: vi.fn(async () => ({ ok: true }))
  };

  await expect(
    sendPersistedMessage({
      client,
      idGenerator: vi
        .fn()
        .mockReturnValueOnce("user-1")
        .mockReturnValueOnce("assistant-1")
        .mockReturnValueOnce("session-1"),
      modelId: "openrouter/fast",
      now: () => 1714528800000,
      prompt: "Who is the minister?"
    })
  ).resolves.toEqual({
    assistantText: "The minister is Purbaya [1].",
    chatId: "chat-1",
    refreshedChat,
    sources: [
      {
        documents: ["Reuters says Purbaya was appointed."],
        index: 1,
        metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
        name: "Reuters",
        url: "https://example.com/reuters"
      }
    ]
  });
  expect(client.completeChat).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.objectContaining({
        sources: [
          {
            documents: ["Reuters says Purbaya was appointed."],
            index: 1,
            metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
            name: "Reuters",
            url: "https://example.com/reuters"
          }
        ]
      })
    })
  );
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

test("loadChatForDisplay uses history content when Open WebUI array messages are placeholders", async () => {
  const chat: ChatTree = {
    id: "chat-1",
    title: "Loaded chat",
    currentId: "assistant-2",
    messages: {},
    raw: {
      chat: {
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "hellow",
            timestamp: 1,
            childrenIds: ["assistant-1"]
          },
          {
            id: "assistant-1",
            role: "assistant",
            content: "",
            timestamp: 2,
            parentId: "user-1"
          },
          {
            id: "user-2",
            role: "user",
            content: "give me markdown example",
            timestamp: 3,
            childrenIds: ["assistant-2"]
          },
          {
            id: "assistant-2",
            role: "assistant",
            content: "",
            timestamp: 4,
            parentId: "user-2"
          }
        ],
        history: {
          messages: {
            "user-1": { id: "user-1", role: "user", content: "hellow", timestamp: 1 },
            "assistant-1": {
              id: "assistant-1",
              role: "assistant",
              content: "Hello! How can I help you today?",
              timestamp: 2,
              done: true
            },
            "user-2": {
              id: "user-2",
              role: "user",
              content: "give me markdown example",
              timestamp: 3
            },
            "assistant-2": {
              id: "assistant-2",
              role: "assistant",
              content: "## Markdown example\n\n- item one\n- item two",
              timestamp: 4,
              done: true
            }
          }
        }
      }
    }
  };
  const client = {
    getChat: vi.fn(async () => chat)
  };

  await expect(loadChatForDisplay({ chatId: "chat-1", client })).resolves.toEqual({
    chat,
    messages: [
      { id: "user-1", role: "user", content: "hellow" },
      { id: "assistant-1", role: "assistant", content: "Hello! How can I help you today?" },
      { id: "user-2", role: "user", content: "give me markdown example" },
      {
        id: "assistant-2",
        role: "assistant",
        content: "## Markdown example\n\n- item one\n- item two"
      }
    ]
  });
});

test("loadChatForDisplay attaches persisted citation sources to assistant messages", async () => {
  const chat: ChatTree = {
    id: "chat-1",
    title: "Loaded chat",
    currentId: "assistant-1",
    messages: {},
    raw: {
      chat: {
        messages: [
          { id: "user-1", role: "user", content: "Who is the minister?", timestamp: 1 },
          {
            id: "assistant-1",
            role: "assistant",
            content: "The minister is Purbaya [1].",
            timestamp: 2,
            citations: [
              {
                document: ["Reuters says Purbaya was appointed."],
                metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
                source: { name: "Reuters", url: "https://example.com/reuters" }
              }
            ]
          }
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
      { id: "user-1", role: "user", content: "Who is the minister?" },
      {
        id: "assistant-1",
        role: "assistant",
        content: "The minister is Purbaya [1].",
        sources: [
          {
            documents: ["Reuters says Purbaya was appointed."],
            index: 1,
            metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
            name: "Reuters",
            url: "https://example.com/reuters"
          }
        ]
      }
    ]
  });
});
