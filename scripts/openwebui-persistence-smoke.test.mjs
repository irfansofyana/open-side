import { describe, expect, test } from "vitest";

import {
  buildAssistantPlaceholderMutation,
  buildCompletedMutation,
  buildInitialChatMutation,
  findPersistedAssistantText
} from "./openwebui-persistence-smoke.mjs";

describe("openwebui persistence smoke payloads", () => {
  test("buildInitialChatMutation creates a model-scoped user message tree", () => {
    expect(
      buildInitialChatMutation({
        modelId: "openrouter/fast",
        prompt: "Say smoke-ok",
        title: "Extension smoke",
        timestamp: 1714528800000,
        userMessageId: "user-1"
      })
    ).toEqual({
      chat: {
        title: "Extension smoke",
        models: ["openrouter/fast"],
        messages: [
          {
            id: "user-1",
            role: "user",
            content: "Say smoke-ok",
            timestamp: 1714528800000,
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
              timestamp: 1714528800000,
              models: ["openrouter/fast"]
            }
          }
        }
      }
    });
  });

  test("buildAssistantPlaceholderMutation injects the assistant node into existing chat state", () => {
    const createdChat = buildInitialChatMutation({
      modelId: "openrouter/fast",
      prompt: "Say smoke-ok",
      title: "Extension smoke",
      timestamp: 1714528800000,
      userMessageId: "user-1"
    }).chat;

    expect(
      buildAssistantPlaceholderMutation({
        chat: createdChat,
        assistantMessageId: "assistant-1",
        modelId: "openrouter/fast",
        timestamp: 1714528800100,
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
              modelName: "openrouter/fast",
              modelIdx: 0
            }
          }
        },
        messages: [
          expect.objectContaining({ id: "user-1" }),
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
});
