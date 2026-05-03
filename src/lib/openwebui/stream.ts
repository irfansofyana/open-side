import type { StreamEvent } from "./types";
import { normalizeCitationSource } from "./citations";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function parseSSELine(line: string): StreamEvent | undefined {
  const trimmedLine = line.trim();
  const isDataLine = line.startsWith("data:");

  if (!isDataLine && !trimmedLine.startsWith("{") && trimmedLine !== "[DONE]") {
    return undefined;
  }

  const data = isDataLine ? line.slice(5).trim() : trimmedLine;
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
  const streamedMessage = isRecord(parsed.message) ? parsed.message : undefined;
  const eventData = isRecord(parsed.data) ? parsed.data : undefined;

  if ((parsed.type === "citation" || parsed.type === "source") && eventData) {
    const citation = normalizeCitationSource(eventData);

    if (citation) {
      return { type: "citation", citation };
    }
  }

  const reasoning =
    delta?.reasoning_content ??
    delta?.reasoning ??
    delta?.thinking ??
    message?.reasoning_content ??
    message?.reasoning ??
    message?.thinking ??
    parsed.reasoning_content ??
    parsed.reasoning ??
    parsed.thinking ??
    eventData?.reasoning_content ??
    eventData?.reasoning ??
    eventData?.thinking;
  const content =
    delta?.content ??
    message?.content ??
    streamedMessage?.content ??
    parsed.response ??
    parsed.content ??
    eventData?.content;

  if (parsed.done === true) {
    return { type: "done" };
  }

  if (
    (parsed.type === "chat:completion" ||
      parsed.type === "chat:message" ||
      parsed.type === "replace") &&
    typeof content === "string"
  ) {
    return { type: "replace", content };
  }

  if (typeof reasoning === "string" && reasoning.length > 0) {
    return { type: "reasoning", content: reasoning };
  }

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

export function parseOpenWebUIRealtimeEvent(event: unknown):
  | {
      chatId?: string;
      done?: boolean;
      event: StreamEvent;
      messageId?: string;
      sessionId?: string;
    }
  | undefined {
  if (!isRecord(event)) {
    return undefined;
  }

  const rootData = isRecord(event.data) ? event.data : undefined;
  const envelope = rootData && typeof rootData.type === "string" ? rootData : event;
  const eventType = typeof envelope.type === "string" ? envelope.type : undefined;
  const eventData = isRecord(envelope.data) ? envelope.data : envelope;
  const getString = (value: Record<string, unknown>, ...keys: string[]): string | undefined => {
    for (const key of keys) {
      const candidate = value[key];

      if (typeof candidate === "string" && candidate.length > 0) {
        return candidate;
      }
    }

    return undefined;
  };
  const chatId =
    getString(event, "chat_id", "chatId") ??
    getString(envelope, "chat_id", "chatId") ??
    getString(eventData, "chat_id", "chatId");
  const messageId =
    getString(event, "message_id", "messageId") ??
    getString(envelope, "message_id", "messageId") ??
    getString(eventData, "message_id", "messageId");
  const sessionId =
    getString(event, "session_id", "sessionId") ??
    getString(envelope, "session_id", "sessionId") ??
    getString(eventData, "session_id", "sessionId");
  const baseEvent = <T extends { event: StreamEvent }>(value: T): T & { sessionId?: string } => ({
    ...value,
    ...(sessionId ? { sessionId } : {})
  });
  const choices = Array.isArray(eventData?.choices) ? eventData.choices : undefined;
  const firstChoice = choices?.[0];
  const delta = isRecord(firstChoice) && isRecord(firstChoice.delta) ? firstChoice.delta : undefined;

  if (!eventType) {
    return undefined;
  }

  if (eventType === "citation" || eventType === "source") {
    const citation = normalizeCitationSource(eventData);

    return citation
      ? baseEvent({ chatId, messageId, event: { type: "citation", citation } })
      : undefined;
  }

  const content = typeof eventData.content === "string" ? eventData.content : undefined;
  const deltaContent = typeof delta?.content === "string" ? delta.content : undefined;
  const deltaReasoning =
    typeof delta?.reasoning_content === "string"
      ? delta.reasoning_content
      : typeof delta?.reasoning === "string"
        ? delta.reasoning
        : typeof delta?.thinking === "string"
          ? delta.thinking
          : undefined;

  if (eventType === "chat:completion") {
    if (deltaReasoning !== undefined) {
      return baseEvent({
        chatId,
        messageId,
        event: { type: "reasoning", content: deltaReasoning }
      });
    }

    if (deltaContent !== undefined) {
      return baseEvent({
        chatId,
        done: eventData.done === true,
        messageId,
        event: { type: "content", content: deltaContent }
      });
    }

    if (content !== undefined) {
      return baseEvent({
        chatId,
        done: eventData.done === true,
        messageId,
        event: { type: "replace", content }
      });
    }

    if (eventData.done === true) {
      return baseEvent({ chatId, done: true, messageId, event: { type: "done" } });
    }
  }

  if (eventType === "chat:message" || eventType === "replace") {
    return content !== undefined
      ? baseEvent({ chatId, messageId, event: { type: "replace", content } })
      : undefined;
  }

  if (
    eventType === "chat:message:delta" ||
    eventType === "message" ||
    eventType === "event:message:delta"
  ) {
    const reasoning =
      typeof eventData.reasoning_content === "string"
        ? eventData.reasoning_content
        : typeof eventData.reasoning === "string"
          ? eventData.reasoning
          : typeof eventData.thinking === "string"
            ? eventData.thinking
            : undefined;

    if (reasoning !== undefined) {
      return baseEvent({ chatId, messageId, event: { type: "reasoning", content: reasoning } });
    }

    return content !== undefined
      ? baseEvent({ chatId, messageId, event: { type: "content", content } })
      : undefined;
  }

  if (eventType === "status" || eventType === "event:status") {
    const status =
      typeof eventData.description === "string"
        ? eventData.description
        : typeof eventData.status === "string"
          ? eventData.status
          : undefined;

    return status
      ? baseEvent({ chatId, messageId, event: { type: "status", status, raw: event } })
      : undefined;
  }

  if (eventType === "error" || eventType === "chat:message:error") {
    const message =
      typeof eventData.content === "string"
        ? eventData.content
        : typeof eventData.message === "string"
          ? eventData.message
          : typeof eventData.error === "string"
            ? eventData.error
            : "Open WebUI stream error";

    return baseEvent({ chatId, messageId, event: { type: "error", message, raw: event } });
  }

  return undefined;
}

type ReadStreamEventsOptions = {
  idleTimeoutMs?: number;
  timeoutMessage?: string;
};

const readWithIdleTimeout = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  { idleTimeoutMs, timeoutMessage }: ReadStreamEventsOptions
): Promise<ReadableStreamReadResult<Uint8Array>> => {
  if (!idleTimeoutMs || idleTimeoutMs <= 0) {
    return reader.read();
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  const timeoutPromise = new Promise<ReadableStreamReadResult<Uint8Array>>((_, reject) => {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      reject(new Error(timeoutMessage ?? "Open WebUI stream stalled"));
    }, idleTimeoutMs);
  });

  try {
    return await Promise.race([reader.read(), timeoutPromise]);
  } catch (error) {
    if (didTimeout) {
      await reader.cancel().catch(() => undefined);
    }

    throw error;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

export async function* readStreamEvents(
  stream: ReadableStream<Uint8Array>,
  options: ReadStreamEventsOptions = {}
): AsyncGenerator<StreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await readWithIdleTimeout(reader, options);
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

    buffer += decoder.decode();
    const tail = parseSSELine(buffer);
    if (tail) {
      yield tail;
    }
  } finally {
    reader.releaseLock();
  }
}
