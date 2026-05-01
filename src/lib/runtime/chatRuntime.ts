import { buildCompletionPayload } from "../openwebui/requestBuilders";
import { readStreamEvents } from "../openwebui/stream";
import type {
  BuildCompletionPayloadInput,
  ChatCompletionRequest,
  ChatMutationPayload,
  ChatMutationResult,
  ChatTree,
  StreamEvent
} from "../openwebui/types";

type StreamingClient = {
  streamChatCompletion: (
    payload: ChatCompletionRequest
  ) => Promise<ReadableStream<Uint8Array>>;
};

type PersistedChatClient = StreamingClient & {
  createChat: (payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  completeChat: (payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  getChat: (chatId: string) => Promise<ChatTree>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

export type SendPersistedMessageInput = Omit<
  BuildCompletionPayloadInput,
  "assistantMessageId" | "chatId" | "messages" | "parentId" | "sessionId" | "userMessage"
> & {
  client: PersistedChatClient;
  prompt: string;
  title?: string;
  idGenerator?: () => string;
  now?: () => number;
  delay?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  pollMaxAttempts?: number;
  onContent?: (content: string) => void;
  onEvent?: (event: StreamEvent) => void;
};

export type SendPersistedMessageResult = {
  assistantText: string;
  chatId: string;
  refreshedChat: ChatTree;
};

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultIdGenerator = (): string => crypto.randomUUID();

const buildAssistantMessage = ({
  assistantMessageId,
  content = "",
  modelId,
  timestamp,
  userMessageId
}: {
  assistantMessageId: string;
  content?: string;
  modelId: string;
  timestamp: number;
  userMessageId: string;
}): Record<string, unknown> => ({
  id: assistantMessageId,
  parentId: userMessageId,
  role: "assistant",
  content,
  timestamp,
  childrenIds: [],
  model: modelId,
  modelName: modelId,
  modelIdx: 0,
  done: false
});

const buildInitialChatMutation = ({
  assistantMessageId,
  modelId,
  prompt,
  timestamp,
  title,
  userMessageId
}: {
  assistantMessageId: string;
  modelId: string;
  prompt: string;
  timestamp: number;
  title: string;
  userMessageId: string;
}): {
  payload: ChatMutationPayload;
  userMessage: Record<string, unknown>;
} => {
  const userMessage = {
    id: userMessageId,
    role: "user",
    content: prompt,
    timestamp,
    models: [modelId],
    childrenIds: [assistantMessageId]
  };
  const assistantMessage = buildAssistantMessage({
    assistantMessageId,
    modelId,
    timestamp: timestamp + 1,
    userMessageId
  });

  return {
    payload: {
      chat: {
        title,
        models: [modelId],
        currentId: assistantMessageId,
        messages: [userMessage, assistantMessage],
        history: {
          currentId: assistantMessageId,
          messages: {
            [userMessageId]: userMessage,
            [assistantMessageId]: assistantMessage
          }
        }
      }
    },
    userMessage
  };
};

const getCreatedChatId = (value: ChatMutationResult): string => {
  const chat = isRecord(value.chat) ? value.chat : undefined;
  const id = value.id ?? chat?.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new Error("Created chat response did not include an id");
  }

  return id;
};

const getPersistedAssistantText = (chat: ChatTree, assistantMessageId: string): string => {
  const historyMessage = chat.messages[assistantMessageId];

  if (
    isRecord(historyMessage) &&
    typeof historyMessage.content === "string"
  ) {
    return historyMessage.content;
  }

  const rawChat = chat.raw?.chat;
  const rawHistoryMessages =
    isRecord(rawChat) && isRecord(rawChat.history)
      ? rawChat.history.messages
      : undefined;
  const rawHistoryMessage =
    isRecord(rawHistoryMessages)
      ? rawHistoryMessages[assistantMessageId]
      : undefined;

  if (
    isRecord(rawHistoryMessage) &&
    typeof rawHistoryMessage.content === "string"
  ) {
    return rawHistoryMessage.content;
  }

  const rawArrayMessages =
    isRecord(rawChat)
      ? rawChat.messages
      : chat.raw?.messages;
  const arrayMessage = Array.isArray(rawArrayMessages)
    ? rawArrayMessages.find(
        (message) =>
          isRecord(message) &&
          message.id === assistantMessageId
      )
    : undefined;

  return isRecord(arrayMessage) && typeof arrayMessage.content === "string"
    ? arrayMessage.content
    : "";
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

export async function sendPersistedMessage({
  client,
  delay = defaultDelay,
  idGenerator = defaultIdGenerator,
  now = Date.now,
  onContent,
  onEvent,
  pollIntervalMs = 2000,
  pollMaxAttempts = 15,
  prompt,
  title,
  ...payloadInput
}: SendPersistedMessageInput): Promise<SendPersistedMessageResult> {
  const userMessageId = idGenerator();
  const assistantMessageId = idGenerator();
  const sessionId = idGenerator();
  const timestamp = Math.floor(now() / 1000);
  const { payload: createPayload, userMessage } = buildInitialChatMutation({
    assistantMessageId,
    modelId: payloadInput.modelId,
    prompt,
    timestamp,
    title: title ?? (prompt.slice(0, 80) || "New chat"),
    userMessageId
  });
  const createdChat = await client.createChat(createPayload);
  const chatId = getCreatedChatId(createdChat);
  const messages = [{ role: "user", content: prompt }];
  const completionPayload = buildCompletionPayload({
    ...payloadInput,
    assistantMessageId,
    backgroundTasks: {
      title_generation: true,
      tags_generation: false,
      follow_up_generation: false
    },
    chatId,
    messages,
    parentId: userMessageId,
    sessionId,
    userMessage
  });
  const stream = await client.streamChatCompletion(completionPayload);
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

  let refreshedChat: ChatTree | undefined;

  if (!assistantText.trim()) {
    for (let attempt = 1; attempt <= pollMaxAttempts; attempt += 1) {
      refreshedChat = await client.getChat(chatId);
      assistantText = getPersistedAssistantText(refreshedChat, assistantMessageId);

      if (assistantText.trim()) {
        onContent?.(assistantText);
        break;
      }

      if (attempt < pollMaxAttempts) {
        await delay(pollIntervalMs);
      }
    }
  }

  if (!assistantText.trim()) {
    throw new Error("Assistant response did not include text content");
  }

  await client.completeChat({
    chat_id: chatId,
    id: assistantMessageId,
    session_id: sessionId,
    model: payloadInput.modelId,
    message: buildAssistantMessage({
      assistantMessageId,
      content: assistantText,
      modelId: payloadInput.modelId,
      timestamp: Math.floor(now() / 1000),
      userMessageId
    })
  });

  refreshedChat = await client.getChat(chatId);

  return {
    assistantText,
    chatId,
    refreshedChat
  };
}
