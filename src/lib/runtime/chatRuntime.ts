import { buildCompletionPayload } from "../openwebui/requestBuilders";
import { readStreamEvents } from "../openwebui/stream";
import type {
  BuildCompletionPayloadInput,
  ChatCompletionRequest,
  StreamEvent
} from "../openwebui/types";

type StreamingClient = {
  streamChatCompletion: (
    payload: ChatCompletionRequest
  ) => Promise<ReadableStream<Uint8Array>>;
};

export type SendStreamingMessageInput = Omit<
  BuildCompletionPayloadInput,
  "messages" | "userMessage"
> & {
  client: StreamingClient;
  prompt: string;
  previousMessages?: Array<Record<string, unknown>>;
  onContent?: (content: string) => void;
  onEvent?: (event: StreamEvent) => void;
};

export type SendStreamingMessageResult = {
  assistantText: string;
};

export async function sendStreamingMessage({
  client,
  prompt,
  previousMessages = [],
  onContent,
  onEvent,
  ...payloadInput
}: SendStreamingMessageInput): Promise<SendStreamingMessageResult> {
  const messages = [...previousMessages, { role: "user", content: prompt }];
  const payload = buildCompletionPayload({
    ...payloadInput,
    messages
  });
  const stream = await client.streamChatCompletion(payload);
  let assistantText = "";

  for await (const event of readStreamEvents(stream)) {
    onEvent?.(event);

    if (event.type === "content") {
      assistantText += event.content;
      onContent?.(event.content);
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  return { assistantText };
}
