import type { StreamEvent } from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseSSELine(line: string): StreamEvent | undefined {
  if (!line.startsWith("data:")) {
    return undefined;
  }

  const data = line.slice(5).trim();
  if (!data) {
    return undefined;
  }

  if (data === "[DONE]") {
    return { type: "done" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { type: "content", content: data };
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  const choices = Array.isArray(parsed.choices) ? parsed.choices : undefined;
  const firstChoice = choices?.[0];
  const delta = isRecord(firstChoice) && isRecord(firstChoice.delta) ? firstChoice.delta : undefined;
  const message =
    isRecord(firstChoice) && isRecord(firstChoice.message) ? firstChoice.message : undefined;
  const content = delta?.content ?? message?.content ?? parsed.content;

  if (typeof content === "string" && content.length > 0) {
    return { type: "content", content };
  }

  if (typeof parsed.status === "string") {
    return { type: "status", status: parsed.status, raw: parsed };
  }

  if (isRecord(parsed.usage)) {
    return { type: "usage", usage: parsed.usage };
  }

  if (typeof parsed.error === "string") {
    return { type: "error", message: parsed.error, raw: parsed };
  }

  return undefined;
}

export async function* readStreamEvents(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseSSELine(line);
      if (event) {
        yield event;
      }
    }
  }

  const tail = parseSSELine(buffer);
  if (tail) {
    yield tail;
  }
}
