import { describe, expect, test } from "vitest";

import {
  buildAssistantPlaceholderMutation,
  buildCompletedMutation,
  buildCompletionRequest,
  buildInitialChatMutation,
  extractContentFromData,
  findPersistedAssistantText,
  selectAssistantText
} from "./openwebui-persistence-smoke.mjs";

describe("openwebui persistence smoke payloads", () => {
  test("buildInitialChatMutation creates a linked user and assistant message tree", () => {
    expect(
      buildInitialChatMutation({
        assistantMessageId: "assistant-1",
        modelId: "openrouter/fast",
        prompt: "Say smoke-ok",
        title: "Extension smoke",
        timestamp: 1714528800,
        userMessageId: "user-1"
      })
    ).toEqual({
      chat: {
        title: "Extension smoke",
        models: ["openrouter/fast"],
        currentId: "assistant-1",
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "Say smoke-ok",
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
            "user-1": {
              id: "user-1",
              role: "user",
              content: "Say smoke-ok",
              timestamp: 1714528800,
              models: ["openrouter/fast"],
              childrenIds: ["assistant-1"]
            },
            "assistant-1": {
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
          }
        }
      }
    });
  });

  test("buildAssistantPlaceholderMutation injects the assistant node into existing chat state", () => {
    const createdChat = {
      title: "Extension smoke",
      models: ["openrouter/fast"],
      messages: [
        {
          id: "user-1",
          role: "user",
          content: "Say smoke-ok",
          timestamp: 1714528800,
          models: ["openrouter/fast"]
        }
      ],
      history: {
        currentId: "user-1",
        messages: {
          "user-1": {
            id: "user-1",
            role: "user",
            content: "Say smoke-ok",
            timestamp: 1714528800,
            models: ["openrouter/fast"]
          }
        }
      }
    };

    expect(
      buildAssistantPlaceholderMutation({
        chat: createdChat,
        assistantMessageId: "assistant-1",
        modelId: "openrouter/fast",
        timestamp: 1714528802,
        userMessageId: "user-1"
      })
    ).toMatchObject({
      chat: {
        history: {
          currentId: "assistant-1",
          messages: {
            "assistant-1": {
              id: "assistant-1",
              parentId: "user-1",
              role: "assistant",
              content: "",
              childrenIds: [],
              model: "openrouter/fast",
              modelName: "openrouter/fast",
              modelIdx: 0,
              done: false
            }
          }
        },
        messages: [
          expect.objectContaining({ id: "user-1", childrenIds: ["assistant-1"] }),
          expect.objectContaining({ id: "assistant-1", parentId: "user-1" })
        ]
      }
    });
  });

  test("buildCompletedMutation includes assistant content and message id", () => {
    expect(
      buildCompletedMutation({
        assistantText: "smoke-ok",
        assistantMessageId: "assistant-1",
        chatId: "chat-1",
        modelId: "openrouter/fast",
        sessionId: "session-1",
        userMessageId: "user-1"
      })
    ).toMatchObject({
      chat_id: "chat-1",
      id: "assistant-1",
      session_id: "session-1",
      model: "openrouter/fast",
      message: {
        id: "assistant-1",
        parentId: "user-1",
        role: "assistant",
        content: "smoke-ok"
      }
    });
  });

  test("buildCompletionRequest includes persistent chat identifiers and web-client payload fields", () => {
    expect(
      buildCompletionRequest({
        assistantMessageId: "assistant-1",
        chatId: "chat-1",
        modelId: "openrouter/fast",
        modelItem: { id: "openrouter/fast", name: "Fast" },
        prompt: "Say smoke-ok",
        sessionId: "session-1",
        userMessage: { id: "user-1", role: "user", content: "Say smoke-ok" },
        userMessageId: "user-1"
      })
    ).toMatchObject({
      stream: true,
      model: "openrouter/fast",
      chat_id: "chat-1",
      id: "assistant-1",
      session_id: "session-1",
      parent_id: "user-1",
      messages: [{ role: "user", content: "Say smoke-ok" }],
      user_message: { id: "user-1", role: "user", content: "Say smoke-ok" },
      model_item: { id: "openrouter/fast", name: "Fast" },
      background_tasks: {
        title_generation: true,
        tags_generation: false,
        follow_up_generation: false
      }
    });
  });

  test("findPersistedAssistantText reads nested history or array messages", () => {
    expect(
      findPersistedAssistantText(
        {
          chat: {
            history: {
              messages: {
                "assistant-1": { role: "assistant", content: "from history" }
              }
            },
            messages: [{ id: "assistant-1", role: "assistant", content: "from array" }]
          }
        },
        "assistant-1"
      )
    ).toBe("from history");

    expect(
      findPersistedAssistantText(
        {
          chat: {
            messages: [{ id: "assistant-1", role: "assistant", content: "from array" }]
          }
        },
        "assistant-1"
      )
    ).toBe("from array");
  });

  test("extractContentFromData reads Open WebUI event-style stream deltas", () => {
    expect(
      extractContentFromData(
        '{"type":"chat:message:delta","data":{"content":"event chunk"}}'
      )
    ).toEqual({ done: false, content: "event chunk" });
    expect(
      extractContentFromData('{"type":"message","data":{"content":"message chunk"}}')
    ).toEqual({ done: false, content: "message chunk" });
  });

  test("selectAssistantText falls back to persisted chat content and reports stream diagnostics", () => {
    expect(
      selectAssistantText({
        streamedText: "",
        persistedText: "persisted chunk",
        diagnostics: {
          dataLines: 2,
          doneSeen: false,
          emptyContentEvents: 2,
          previews: ["{}"]
        }
      })
    ).toBe("persisted chunk");

    expect(() =>
      selectAssistantText({
        streamedText: "",
        persistedText: "",
        diagnostics: {
          dataLines: 1,
          doneSeen: true,
          emptyContentEvents: 1,
          previews: ['{"done":true}']
        }
      })
    ).toThrow(
      'Assistant response did not include text content (data lines: 1, empty content events: 1, done seen: true, previews: {"done":true})'
    );
  });
});
