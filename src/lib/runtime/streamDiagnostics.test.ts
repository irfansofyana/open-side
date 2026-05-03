import { createStreamDiagnosticsLogger } from "./streamDiagnostics";

test("stream diagnostics redacts sensitive fields and keeps a bounded buffer", () => {
  const sink = vi.fn();
  const logger = createStreamDiagnosticsLogger({
    maxEntries: 2,
    now: () => 1714528800000,
    sink
  });

  logger.log("chat.send.start", {
    authorization: "Bearer token",
    content: "assistant text",
    modelId: "openrouter/fast",
    prompt: "secret prompt",
    safeCount: 2,
    token: "abc"
  });
  logger.log("http.stream.event", { contentLength: 5, type: "content" });
  logger.log("chat.stream.done", { source: "http" });

  expect(logger.getEntries()).toEqual([
    {
      at: "2024-05-01T02:00:00.000Z",
      event: "http.stream.event",
      fields: { contentLength: 5, type: "content" }
    },
    {
      at: "2024-05-01T02:00:00.000Z",
      event: "chat.stream.done",
      fields: { source: "http" }
    }
  ]);
  expect(sink).toHaveBeenCalledWith("chat.send.start", {
    authorization: "[redacted]",
    content: "[redacted]",
    modelId: "openrouter/fast",
    prompt: "[redacted]",
    safeCount: 2,
    token: "[redacted]"
  });
});
