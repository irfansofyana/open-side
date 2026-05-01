import { sendStreamingMessage } from "./chatRuntime";
import type { ChatCompletionRequest } from "../openwebui/types";

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
