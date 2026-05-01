import { parseSSELine, readStreamEvents } from "./stream";

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
