import { parseOpenWebUIRealtimeEvent, parseSSELine, readStreamEvents } from "./stream";

test("parseSSELine extracts OpenAI delta content", () => {
  expect(parseSSELine('data: {"choices":[{"delta":{"content":"ok"}}]}')).toEqual({
    type: "content",
    content: "ok"
  });
});

test("parseSSELine extracts Open WebUI event-style content", () => {
  expect(
    parseSSELine('data: {"type":"chat:message:delta","data":{"content":"ok"}}')
  ).toEqual({
    type: "content",
    content: "ok"
  });
  expect(parseSSELine('data: {"type":"message","data":{"content":"done"}}')).toEqual({
    type: "content",
    content: "done"
  });
});

test("parseSSELine extracts Open WebUI newline-delimited JSON chat chunks", () => {
  expect(
    parseSSELine('{"done":false,"message":{"role":"assistant","content":"Hello"}}')
  ).toEqual({
    type: "content",
    content: "Hello"
  });
  expect(
    parseSSELine('{"done":false,"message":{"role":"assistant","content":" live"}}')
  ).toEqual({
    type: "content",
    content: " live"
  });
  expect(parseSSELine('{"done":true,"total_duration":123}')).toEqual({ type: "done" });
});

test("readStreamEvents reads split Open WebUI JSONL chunks", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(
        encoder.encode('{"done":false,"message":{"content":"smoke"}}\n{"done":false,')
      );
      controller.enqueue(encoder.encode('"message":{"content":"-ok"}}\n'));
      controller.enqueue(encoder.encode('{"done":true}\n'));
      controller.close();
    }
  });

  const events = [];
  for await (const event of readStreamEvents(stream)) {
    events.push(event);
  }

  expect(events).toEqual([
    { type: "content", content: "smoke" },
    { type: "content", content: "-ok" },
    { type: "done" }
  ]);
});

test("parseOpenWebUIRealtimeEvent extracts socket message deltas", () => {
  expect(
    parseOpenWebUIRealtimeEvent({
      chat_id: "chat-1",
      message_id: "assistant-1",
      data: {
        type: "chat:message:delta",
        data: { content: "live token" }
      }
    })
  ).toEqual({
    chatId: "chat-1",
    messageId: "assistant-1",
    event: { type: "content", content: "live token" }
  });
});

test("parseOpenWebUIRealtimeEvent extracts flat socket message deltas", () => {
  expect(
    parseOpenWebUIRealtimeEvent({
      chat_id: "chat-1",
      message_id: "assistant-1",
      session_id: "socket-1",
      type: "event:message:delta",
      data: { content: "flat token" }
    })
  ).toEqual({
    chatId: "chat-1",
    messageId: "assistant-1",
    sessionId: "socket-1",
    event: { type: "content", content: "flat token" }
  });
});

test("parseOpenWebUIRealtimeEvent extracts OpenAI-style chat completion socket deltas", () => {
  expect(
    parseOpenWebUIRealtimeEvent({
      session_id: "socket-1",
      data: {
        type: "chat:completion",
        data: {
          choices: [{ delta: { content: "token" }, finish_reason: null }]
        }
      }
    })
  ).toEqual({
    chatId: undefined,
    done: false,
    event: { type: "content", content: "token" },
    messageId: undefined,
    sessionId: "socket-1"
  });
});

test("parseOpenWebUIRealtimeEvent treats chat completion content as a replacement snapshot", () => {
  expect(
    parseOpenWebUIRealtimeEvent({
      chat_id: "chat-1",
      message_id: "assistant-1",
      data: {
        type: "chat:completion",
        data: { content: "full response so far", done: true }
      }
    })
  ).toEqual({
    chatId: "chat-1",
    done: true,
    messageId: "assistant-1",
    event: { type: "replace", content: "full response so far" }
  });

  expect(
    parseOpenWebUIRealtimeEvent({
      chat_id: "chat-1",
      message_id: "assistant-1",
      data: {
        type: "chat:completion",
        data: { done: true }
      }
    })
  ).toEqual({
    chatId: "chat-1",
    done: true,
    messageId: "assistant-1",
    event: { type: "done" }
  });
});

test("parseOpenWebUIRealtimeEvent extracts citation socket events", () => {
  expect(
    parseOpenWebUIRealtimeEvent({
      chat_id: "chat-1",
      message_id: "assistant-1",
      data: {
        type: "citation",
        data: {
          document: ["Article text"],
          metadata: [{ source: "Reuters", url: "https://example.com/article" }]
        }
      }
    })
  ).toEqual({
    chatId: "chat-1",
    messageId: "assistant-1",
    event: {
      type: "citation",
      citation: {
        documents: ["Article text"],
        index: 1,
        metadata: [{ source: "Reuters", url: "https://example.com/article" }],
        name: "Reuters",
        url: "https://example.com/article"
      }
    }
  });
});

test("parseSSELine extracts reasoning delta fields used by reasoning models", () => {
  expect(
    parseSSELine('data: {"choices":[{"delta":{"reasoning_content":"Thinking"}}]}')
  ).toEqual({
    type: "reasoning",
    content: "Thinking"
  });
  expect(parseSSELine('data: {"choices":[{"delta":{"reasoning":" deeply"}}]}')).toEqual({
    type: "reasoning",
    content: " deeply"
  });
  expect(parseSSELine('data: {"choices":[{"delta":{"thinking":" now"}}]}')).toEqual({
    type: "reasoning",
    content: " now"
  });
  expect(
    parseSSELine('data: {"type":"chat:message:delta","data":{"reasoning_content":" about it"}}')
  ).toEqual({
    type: "reasoning",
    content: " about it"
  });
});

test("parseSSELine extracts Open WebUI citation events", () => {
  expect(
    parseSSELine(
      'data: {"type":"citation","data":{"document":["Article text"],"metadata":[{"source":"Reuters","url":"https://example.com/article"}],"source":{"name":"Reuters","url":"https://example.com/article"}}}'
    )
  ).toEqual({
    type: "citation",
    citation: {
      documents: ["Article text"],
      index: 1,
      metadata: [{ source: "Reuters", url: "https://example.com/article" }],
      name: "Reuters",
      url: "https://example.com/article"
    }
  });
});

test("parseSSELine handles done, status, usage, error, and raw text", () => {
  expect(parseSSELine("data: [DONE]")).toEqual({ type: "done" });
  expect(parseSSELine('data: {"status":"Searching"}')).toEqual({
    type: "status",
    status: "Searching",
    raw: { status: "Searching" }
  });
  expect(parseSSELine('data: {"usage":{"total_tokens":3}}')).toEqual({
    type: "usage",
    usage: { total_tokens: 3 }
  });
  expect(parseSSELine('data: {"error":"Nope"}')).toEqual({
    type: "error",
    message: "Nope",
    raw: { error: "Nope" }
  });
  expect(parseSSELine("data: raw text")).toEqual({
    type: "content",
    content: "raw text"
  });
});

test("readStreamEvents reads split SSE chunks", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"smoke"}}]}\n'));
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"-ok"}}]}\n'));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });

  const events = [];
  for await (const event of readStreamEvents(stream)) {
    events.push(event);
  }

  expect(events).toEqual([
    { type: "content", content: "smoke" },
    { type: "content", content: "-ok" },
    { type: "done" }
  ]);
});
