import { buildCompletionPayload } from "../openwebui/requestBuilders";
import { readStreamEvents } from "../openwebui/stream";
import type {
  BuildCompletionPayloadInput,
  ChatCompletionRequest,
  ChatMutationPayload,
  ChatMutationResult,
  ChatSummary,
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
  updateChat: (chatId: string, payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  completeChat: (payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  getChat: (chatId: string) => Promise<ChatTree>;
};

type RecentChatsClient = {
  getChats: (options: { page: number; includePinned: boolean }) => Promise<ChatSummary[]>;
};

type ChatLoaderClient = {
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
  activeChat?: ChatTree;
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

export type DisplayChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export type LoadChatForDisplayResult = {
  chat: ChatTree;
  messages: DisplayChatMessage[];
};

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultIdGenerator = (): string => crypto.randomUUID();

const buildAssistantMessage = ({
  assistantMessageId,
  content = "",
  done = false,
  modelId,
  timestamp,
  userMessageId
}: {
  assistantMessageId: string;
  content?: string;
  done?: boolean;
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
  done
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

const appendChildId = (message: Record<string, unknown>, childId: string): Record<string, unknown> => {
  const childrenIds = Array.isArray(message.childrenIds)
    ? message.childrenIds.filter((value): value is string => typeof value === "string")
    : [];

  return {
    ...message,
    childrenIds: childrenIds.includes(childId) ? childrenIds : [...childrenIds, childId]
  };
};

const getRawChat = (chat: ChatTree): Record<string, unknown> => {
  if (isRecord(chat.raw?.chat)) {
    return chat.raw.chat;
  }

  return {
    title: chat.title,
    currentId: chat.currentId,
    messages: Object.values(chat.messages).filter(isRecord),
    history: {
      currentId: chat.currentId,
      messages: chat.messages
    }
  };
};

const getMessageContent = (message: Record<string, unknown>): string | undefined =>
  typeof message.content === "string" ? message.content : undefined;

const getMessageContentWithHistory = (
  message: Record<string, unknown>,
  historyMessages: Record<string, unknown>
): string | undefined => {
  const content = getMessageContent(message);

  if (content && content.length > 0) {
    return content;
  }

  const id = typeof message.id === "string" ? message.id : undefined;
  const historyMessage = id ? historyMessages[id] : undefined;
  const historyContent = isRecord(historyMessage) ? getMessageContent(historyMessage) : undefined;

  return historyContent ?? content;
};

const getMessageRole = (message: Record<string, unknown>): "user" | "assistant" | undefined =>
  message.role === "user" || message.role === "assistant" ? message.role : undefined;

const getMessageId = (message: Record<string, unknown>, index: number): string =>
  typeof message.id === "string" && message.id.length > 0
    ? message.id
    : `message-${index}`;

const getRawMessagesArray = (chat: ChatTree): Record<string, unknown>[] => {
  const rawChat = chat.raw?.chat;
  const rawMessages = isRecord(rawChat) ? rawChat.messages : chat.raw?.messages;

  return Array.isArray(rawMessages) ? rawMessages.filter(isRecord) : [];
};

const getRawHistoryMessages = (chat: ChatTree): Record<string, unknown>[] => {
  const rawChat = chat.raw?.chat;
  const rawHistory =
    isRecord(rawChat) && isRecord(rawChat.history) ? rawChat.history.messages : undefined;
  const messages = isRecord(rawHistory) ? rawHistory : chat.messages;

  return Object.values(messages).filter(isRecord);
};

const getRawHistoryMessagesRecord = (chat: ChatTree): Record<string, unknown> => {
  const rawChat = chat.raw?.chat;
  const rawHistory =
    isRecord(rawChat) && isRecord(rawChat.history) ? rawChat.history.messages : undefined;
  const messages = isRecord(rawHistory) ? rawHistory : chat.messages;

  return Object.fromEntries(Object.entries(messages).filter((entry): entry is [string, unknown] => isRecord(entry[1])));
};

const toDisplayMessages = (chat: ChatTree): DisplayChatMessage[] => {
  const rawArrayMessages = getRawMessagesArray(chat);
  const rawHistoryMessages = getRawHistoryMessagesRecord(chat);
  const sourceMessages = rawArrayMessages.length > 0 ? rawArrayMessages : getRawHistoryMessages(chat);
  const orderedMessages =
    rawArrayMessages.length > 0
      ? sourceMessages
      : [...sourceMessages].sort((left, right) => {
          const leftTimestamp = typeof left.timestamp === "number" ? left.timestamp : 0;
          const rightTimestamp = typeof right.timestamp === "number" ? right.timestamp : 0;

          return leftTimestamp - rightTimestamp;
        });

  return orderedMessages.flatMap((message, index) => {
    const role = getMessageRole(message);
    const content =
      rawArrayMessages.length > 0
        ? getMessageContentWithHistory(message, rawHistoryMessages)
        : getMessageContent(message);

    return role && content !== undefined
      ? [{ id: getMessageId(message, index), role, content }]
      : [];
  });
};

const toCompletionMessages = (
  messages: Array<Record<string, unknown>>,
  prompt: string
): Array<Record<string, unknown>> => [
  ...messages.flatMap((message) => {
    const role = typeof message.role === "string" ? message.role : undefined;
    const content = getMessageContent(message);

    return role && content !== undefined ? [{ role, content }] : [];
  }),
  { role: "user", content: prompt }
];

const buildContinuationChatMutation = ({
  activeChat,
  assistantMessageId,
  modelId,
  prompt,
  timestamp,
  userMessageId
}: {
  activeChat: ChatTree;
  assistantMessageId: string;
  modelId: string;
  prompt: string;
  timestamp: number;
  userMessageId: string;
}): {
  chatId: string;
  messages: Array<Record<string, unknown>>;
  parentId: string;
  payload: ChatMutationPayload;
  userMessage: Record<string, unknown>;
} => {
  const currentChat = getRawChat(activeChat);
  const history = isRecord(currentChat.history) ? currentChat.history : {};
  const historyMessages = isRecord(history.messages) ? history.messages : activeChat.messages;
  const existingMessages = Array.isArray(currentChat.messages)
    ? currentChat.messages.filter(isRecord)
    : Object.values(historyMessages).filter(isRecord);
  const parentId =
    typeof currentChat.currentId === "string"
      ? currentChat.currentId
      : typeof history.currentId === "string"
        ? history.currentId
        : activeChat.currentId;
  const userMessage = {
    id: userMessageId,
    parentId,
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
  const nextMessages = existingMessages.map((message) =>
    message.id === parentId ? appendChildId(message, userMessageId) : message
  );
  const nextHistoryMessages: Record<string, unknown> = { ...historyMessages };
  const parentMessage = parentId ? nextHistoryMessages[parentId] : undefined;

  if (parentId && isRecord(parentMessage)) {
    nextHistoryMessages[parentId] = appendChildId(parentMessage, userMessageId);
  }

  return {
    chatId: activeChat.id,
    messages: toCompletionMessages(existingMessages, prompt),
    parentId: userMessageId,
    payload: {
      chat: {
        ...currentChat,
        title:
          typeof currentChat.title === "string" && currentChat.title.length > 0
            ? currentChat.title
            : activeChat.title,
        models: Array.isArray(currentChat.models) ? currentChat.models : [modelId],
        currentId: assistantMessageId,
        messages: [...nextMessages, userMessage, assistantMessage],
        history: {
          ...history,
          currentId: assistantMessageId,
          messages: {
            ...nextHistoryMessages,
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

const appendContentDelta = ({
  assistantText,
  content,
  onContent
}: {
  assistantText: string;
  content: string;
  onContent?: (content: string) => void;
}): string => {
  const nextText = `${assistantText}${content}`;
  onContent?.(content);

  return nextText;
};

const appendReasoningDelta = ({
  assistantText,
  content,
  isReasoningOpen,
  onContent
}: {
  assistantText: string;
  content: string;
  isReasoningOpen: boolean;
  onContent?: (content: string) => void;
}): { assistantText: string; isReasoningOpen: boolean } => {
  const prefix = isReasoningOpen ? "" : "<think>";

  if (prefix) {
    onContent?.(prefix);
  }
  onContent?.(content);

  return {
    assistantText: `${assistantText}${prefix}${content}`,
    isReasoningOpen: true
  };
};

const closeReasoningBlock = ({
  assistantText,
  isReasoningOpen,
  onContent
}: {
  assistantText: string;
  isReasoningOpen: boolean;
  onContent?: (content: string) => void;
}): { assistantText: string; isReasoningOpen: boolean } => {
  if (!isReasoningOpen) {
    return { assistantText, isReasoningOpen };
  }

  const suffix = "</think>\n\n";
  onContent?.(suffix);

  return {
    assistantText: `${assistantText}${suffix}`,
    isReasoningOpen: false
  };
};

const emitPersistedDelta = ({
  assistantText,
  onContent,
  persistedText
}: {
  assistantText: string;
  onContent?: (content: string) => void;
  persistedText: string;
}): string => {
  if (!persistedText.startsWith(assistantText)) {
    onContent?.(persistedText);
    return persistedText;
  }

  const delta = persistedText.slice(assistantText.length);

  if (delta.length > 0) {
    onContent?.(delta);
  }

  return persistedText;
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
  let isReasoningOpen = false;

  for await (const event of readStreamEvents(stream)) {
    onEvent?.(event);

    if (event.type === "reasoning") {
      const result = appendReasoningDelta({
        assistantText,
        content: event.content,
        isReasoningOpen,
        onContent
      });
      assistantText = result.assistantText;
      isReasoningOpen = result.isReasoningOpen;
    }

    if (event.type === "content") {
      const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
      assistantText = appendContentDelta({
        assistantText: closed.assistantText,
        content: event.content,
        onContent
      });
      isReasoningOpen = closed.isReasoningOpen;
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
  assistantText = closed.assistantText;

  return { assistantText };
}

export async function listRecentChats({
  client
}: {
  client: RecentChatsClient;
}): Promise<ChatSummary[]> {
  return client.getChats({ page: 1, includePinned: true });
}

export async function loadChatForDisplay({
  chatId,
  client
}: {
  chatId: string;
  client: ChatLoaderClient;
}): Promise<LoadChatForDisplayResult> {
  const chat = await client.getChat(chatId);

  return {
    chat,
    messages: toDisplayMessages(chat)
  };
}

export async function sendPersistedMessage({
  activeChat,
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
  const chatSetup = activeChat
    ? buildContinuationChatMutation({
        activeChat,
        assistantMessageId,
        modelId: payloadInput.modelId,
        prompt,
        timestamp,
        userMessageId
      })
    : (() => {
        const { payload, userMessage } = buildInitialChatMutation({
          assistantMessageId,
          modelId: payloadInput.modelId,
          prompt,
          timestamp,
          title: title ?? (prompt.slice(0, 80) || "New chat"),
          userMessageId
        });

        return {
          chatId: undefined,
          messages: [{ role: "user", content: prompt }],
          parentId: userMessageId,
          payload,
          userMessage
        };
      })();
  const chatId = chatSetup.chatId ?? getCreatedChatId(await client.createChat(chatSetup.payload));

  if (chatSetup.chatId) {
    await client.updateChat(chatId, chatSetup.payload);
  }

  const completionPayload = buildCompletionPayload({
    ...payloadInput,
    assistantMessageId,
    backgroundTasks: {
      title_generation: true,
      tags_generation: false,
      follow_up_generation: false
    },
    chatId,
    messages: chatSetup.messages,
    parentId: chatSetup.parentId,
    sessionId,
    userMessage: chatSetup.userMessage
  });
  const stream = await client.streamChatCompletion(completionPayload);
  let assistantText = "";
  let isReasoningOpen = false;

  for await (const event of readStreamEvents(stream)) {
    onEvent?.(event);

    if (event.type === "reasoning") {
      const result = appendReasoningDelta({
        assistantText,
        content: event.content,
        isReasoningOpen,
        onContent
      });
      assistantText = result.assistantText;
      isReasoningOpen = result.isReasoningOpen;
    }

    if (event.type === "content") {
      const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
      assistantText = appendContentDelta({
        assistantText: closed.assistantText,
        content: event.content,
        onContent
      });
      isReasoningOpen = closed.isReasoningOpen;
    }

    if (event.type === "error") {
      throw new Error(event.message);
    }
  }

  const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
  assistantText = closed.assistantText;

  let refreshedChat: ChatTree | undefined;
  const shouldPollPersistedText = !assistantText.trim();

  for (
    let attempt = 1;
    shouldPollPersistedText && attempt <= pollMaxAttempts;
    attempt += 1
  ) {
    refreshedChat = await client.getChat(chatId);
    const persistedText = getPersistedAssistantText(refreshedChat, assistantMessageId);

    if (persistedText.trim()) {
      assistantText = emitPersistedDelta({ assistantText, onContent, persistedText });
    }

    const persistedMessage = refreshedChat.messages[assistantMessageId];
    const isDone =
      isRecord(persistedMessage) && typeof persistedMessage.done === "boolean"
        ? persistedMessage.done
        : false;

    if (assistantText.trim() && isDone) {
      break;
    }

    if (assistantText.trim() && attempt >= 3) {
      break;
    }

    if (attempt < pollMaxAttempts) {
      await delay(pollIntervalMs);
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
      done: true,
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
