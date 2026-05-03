import {
  buildCompletionPayload,
  buildOpenWebUIPromptVariables,
  isOpenWebUINativeFunctionCallingModel
} from "../openwebui/requestBuilders";
import { parseOpenWebUIRealtimeEvent, readStreamEvents } from "../openwebui/stream";
import { normalizeCitationSources } from "../openwebui/citations";
import type { StreamDiagnosticsLogger } from "./streamDiagnostics";
import type {
  BuildCompletionPayloadInput,
  ChatCompletionRequest,
  ChatMutationPayload,
  ChatMutationResult,
  ChatSummary,
  ChatTree,
  CitationSource,
  StreamEvent
} from "../openwebui/types";

type StreamingClient = {
  streamChatCompletion: (
    payload: ChatCompletionRequest
  ) => Promise<ReadableStream<Uint8Array>>;
};

type PersistedChatClient = StreamingClient & {
  createChat: (payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  triggerChatCompletion?: (payload: ChatCompletionRequest) => Promise<ChatMutationResult>;
  updateChat: (chatId: string, payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  completeChat: (payload: ChatMutationPayload) => Promise<ChatMutationResult>;
  getChat: (chatId: string) => Promise<ChatTree>;
};

type RealtimeClient = {
  connect: () => Promise<{ sessionId: string }>;
  disconnect?: () => void;
  onEvent: (handler: (event: unknown) => void) => () => void;
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
  sources?: CitationSource[];
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
  diagnostics?: Pick<StreamDiagnosticsLogger, "log">;
  realtimeFallbackPollDelayMs?: number;
  pollIntervalMs?: number;
  pollMaxAttempts?: number;
  realtimeClient?: RealtimeClient;
  onContent?: (content: string) => void;
  onEvent?: (event: StreamEvent) => void;
};

export type SendDirectPersistedMessageInput = Omit<
  SendPersistedMessageInput,
  | "delay"
  | "pollIntervalMs"
  | "pollMaxAttempts"
  | "realtimeClient"
  | "realtimeFallbackPollDelayMs"
> & {
  streamIdleTimeoutMs?: number;
};

export type SendPersistedMessageResult = {
  assistantText: string;
  chatId: string;
  refreshedChat: ChatTree;
  sources?: CitationSource[];
};

export type DisplayChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: CitationSource[];
};

export type LoadChatForDisplayResult = {
  chat: ChatTree;
  messages: DisplayChatMessage[];
};

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const defaultIdGenerator = (): string => crypto.randomUUID();

const withDefaultPromptVariables = <T extends { variables?: Record<string, unknown> }>(
  payloadInput: T,
  now?: () => number
): T & { variables: Record<string, unknown> } => ({
  ...payloadInput,
  variables:
    payloadInput.variables ??
    buildOpenWebUIPromptVariables(now ? { now: new Date(now()) } : {})
});

const buildAssistantMessage = ({
  assistantMessageId,
  content = "",
  done = false,
  modelId,
  timestamp,
  userMessageId,
  sources
}: {
  assistantMessageId: string;
  content?: string;
  done?: boolean;
  modelId: string;
  sources?: CitationSource[];
  timestamp: number;
  userMessageId: string;
}): Record<string, unknown> => {
  const message: Record<string, unknown> = {
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
  };

  if (sources && sources.length > 0) {
    message.sources = sources;
  }

  return message;
};

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

const getMessageSources = (message: unknown): CitationSource[] => {
  if (!isRecord(message)) {
    return [];
  }

  const metadata = isRecord(message.metadata) ? message.metadata : undefined;
  const candidates = [
    message.sources,
    message.citations,
    message.source,
    message.citation,
    metadata?.sources,
    metadata?.citations,
    metadata?.source,
    metadata?.citation
  ];

  for (const candidate of candidates) {
    const sources = normalizeCitationSources(candidate);

    if (sources.length > 0) {
      return sources;
    }
  }

  return [];
};

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
    const historyMessage =
      typeof message.id === "string" && isRecord(rawHistoryMessages[message.id])
        ? rawHistoryMessages[message.id]
        : undefined;
    const sources = [...getMessageSources(message), ...getMessageSources(historyMessage ?? {})];
    const displayMessage = role && content !== undefined
      ? { id: getMessageId(message, index), role, content }
      : undefined;

    if (!displayMessage) {
      return [];
    }

    return sources.length > 0 && role === "assistant"
      ? [{ ...displayMessage, sources: normalizeCitationSources(sources) }]
      : [displayMessage];
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

const getPersistedAssistantSources = (
  chat: ChatTree,
  assistantMessageId: string
): CitationSource[] => {
  const historyMessage = chat.messages[assistantMessageId];

  if (isRecord(historyMessage)) {
    const sources = getMessageSources(historyMessage);

    if (sources.length > 0) {
      return sources;
    }
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

  if (isRecord(rawHistoryMessage)) {
    const sources = getMessageSources(rawHistoryMessage);

    if (sources.length > 0) {
      return sources;
    }
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

  return isRecord(arrayMessage) ? getMessageSources(arrayMessage) : [];
};

const nonAnswerBlockPattern = new RegExp(
  [
    '<details\\s+[^>]*type=["\\\'](?:reasoning|tool_calls)["\\\'][^>]*>[\\s\\S]*?<\\/details>',
    "<think>[\\s\\S]*?<\\/think>",
    "<thinking>[\\s\\S]*?<\\/thinking>",
    "<reason>[\\s\\S]*?<\\/reason>",
    "<reasoning>[\\s\\S]*?<\\/reasoning>",
    "<thought>[\\s\\S]*?<\\/thought>",
    "<\\|begin_of_thought\\|>[\\s\\S]*?<\\|end_of_thought\\|>"
  ].join("|"),
  "gi"
);

const trailingNonAnswerBlockPattern = new RegExp(
  [
    '<details\\s+[^>]*type=["\\\'](?:reasoning|tool_calls)["\\\'][^>]*>[\\s\\S]*$',
    "<think>[\\s\\S]*$",
    "<thinking>[\\s\\S]*$",
    "<reason>[\\s\\S]*$",
    "<reasoning>[\\s\\S]*$",
    "<thought>[\\s\\S]*$",
    "<\\|begin_of_thought\\|>[\\s\\S]*$"
  ].join("|"),
  "gi"
);

const hasAssistantAnswerText = (content: string): boolean =>
  content
    .replace(nonAnswerBlockPattern, "")
    .replace(trailingNonAnswerBlockPattern, "")
    .trim().length > 0;

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

const replaceAssistantMessageInPayload = ({
  assistantMessage,
  assistantMessageId,
  payload
}: {
  assistantMessage: Record<string, unknown>;
  assistantMessageId: string;
  payload: ChatMutationPayload;
}): ChatMutationPayload => {
  const chat = isRecord(payload.chat) ? payload.chat : {};
  const messages = Array.isArray(chat.messages)
    ? chat.messages.map((message) =>
        isRecord(message) && message.id === assistantMessageId ? assistantMessage : message
      )
    : chat.messages;
  const history = isRecord(chat.history) ? chat.history : {};
  const historyMessages = isRecord(history.messages) ? history.messages : {};

  return {
    ...payload,
    chat: {
      ...chat,
      messages,
      history: {
        ...history,
        messages: {
          ...historyMessages,
          [assistantMessageId]: assistantMessage
        }
      }
    }
  };
};

const applyAssistantStreamEvent = ({
  assistantText,
  event,
  isReasoningOpen,
  onContent,
  onEvent,
  sources
}: {
  assistantText: string;
  event: StreamEvent;
  isReasoningOpen: boolean;
  onContent?: (content: string) => void;
  onEvent?: (event: StreamEvent) => void;
  sources: CitationSource[];
}): {
  assistantText: string;
  isReasoningOpen: boolean;
  sources: CitationSource[];
} => {
  onEvent?.(event);

  if (event.type === "citation") {
    return {
      assistantText,
      isReasoningOpen,
      sources: normalizeCitationSources([...sources, event.citation])
    };
  }

  if (event.type === "reasoning") {
    const result = appendReasoningDelta({
      assistantText,
      content: event.content,
      isReasoningOpen,
      onContent
    });

    return {
      assistantText: result.assistantText,
      isReasoningOpen: result.isReasoningOpen,
      sources
    };
  }

  if (event.type === "content") {
    const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });

    return {
      assistantText: appendContentDelta({
        assistantText: closed.assistantText,
        content: event.content,
        onContent
      }),
      isReasoningOpen: closed.isReasoningOpen,
      sources
    };
  }

  if (event.type === "replace") {
    const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });

    return {
      assistantText: emitPersistedDelta({
        assistantText: closed.assistantText,
        onContent,
        persistedText: event.content
      }),
      isReasoningOpen: closed.isReasoningOpen,
      sources
    };
  }

  if (event.type === "error") {
    throw new Error(event.message);
  }

  return { assistantText, isReasoningOpen, sources };
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
    ...withDefaultPromptVariables(payloadInput),
    messages
  });
  const stream = await client.streamChatCompletion(payload);
  let assistantText = "";
  let isReasoningOpen = false;
  let sources: CitationSource[] = [];

  for await (const event of readStreamEvents(stream)) {
    const result = applyAssistantStreamEvent({
      assistantText,
      event,
      isReasoningOpen,
      onContent,
      onEvent,
      sources
    });
    assistantText = result.assistantText;
    isReasoningOpen = result.isReasoningOpen;
    sources = result.sources;
  }

  const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
  assistantText = closed.assistantText;

  return sources.length > 0 ? { assistantText, sources } : { assistantText };
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

export async function sendDirectPersistedMessage({
  activeChat,
  client,
  diagnostics,
  idGenerator = defaultIdGenerator,
  now = Date.now,
  onContent,
  onEvent,
  prompt,
  streamIdleTimeoutMs = 60000,
  title,
  ...payloadInput
}: SendDirectPersistedMessageInput): Promise<SendPersistedMessageResult> {
  diagnostics?.log("chat.direct.send.start", {
    activeChat: Boolean(activeChat),
    modelId: payloadInput.modelId,
    promptLength: prompt.length
  });
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
  const streamPayload = buildCompletionPayload({
    ...withDefaultPromptVariables(payloadInput, now),
    isPipeModel: true,
    messages: chatSetup.messages
  });
  const stream = await client.streamChatCompletion(streamPayload);
  let assistantText = "";
  let hasAnswerText = false;
  let isReasoningOpen = false;
  let sources: CitationSource[] = [];
  let sawFirstText = false;

  diagnostics?.log("chat.direct.stream.opened", { modelId: payloadInput.modelId });

  for await (const event of readStreamEvents(stream, {
    idleTimeoutMs: streamIdleTimeoutMs,
    timeoutMessage: "Open WebUI direct stream stalled"
  })) {
    const isTextEvent =
      event.type === "content" || event.type === "reasoning" || event.type === "replace";
    const isAnswerEvent = event.type === "content" || event.type === "replace";

    if (isTextEvent && !sawFirstText) {
      sawFirstText = true;
      diagnostics?.log("chat.direct.first_text", { source: "http" });
    }

    if (isAnswerEvent && event.content.trim()) {
      hasAnswerText = true;
    }

    const result = applyAssistantStreamEvent({
      assistantText,
      event,
      isReasoningOpen,
      onContent,
      onEvent,
      sources
    });
    assistantText = result.assistantText;
    isReasoningOpen = result.isReasoningOpen;
    sources = result.sources;
  }

  const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
  assistantText = closed.assistantText;

  if (!hasAnswerText && !assistantText.trim()) {
    throw new Error("Assistant response did not include text content");
  }

  if (!hasAnswerText) {
    diagnostics?.log("chat.direct.reasoning_only", {
      assistantChars: assistantText.length,
      modelId: payloadInput.modelId
    });
  }

  diagnostics?.log("chat.direct.persist.start", {
    assistantChars: assistantText.length,
    activeChat: Boolean(activeChat)
  });

  const assistantMessage = buildAssistantMessage({
    assistantMessageId,
    content: assistantText,
    done: true,
    modelId: payloadInput.modelId,
    sources,
    timestamp: Math.floor(now() / 1000),
    userMessageId
  });
  const finalPayload = replaceAssistantMessageInPayload({
    assistantMessage,
    assistantMessageId,
    payload: chatSetup.payload
  });
  const chatId = chatSetup.chatId
    ? chatSetup.chatId
    : getCreatedChatId(await client.createChat(finalPayload));

  if (chatSetup.chatId) {
    await client.updateChat(chatId, finalPayload);
  }

  await client.completeChat({
    chat_id: chatId,
    id: assistantMessageId,
    session_id: sessionId,
    model: payloadInput.modelId,
    message: assistantMessage
  });

  const refreshedChat = await client.getChat(chatId);
  sources = normalizeCitationSources([
    ...sources,
    ...getPersistedAssistantSources(refreshedChat, assistantMessageId)
  ]);
  diagnostics?.log("chat.direct.send.done", {
    assistantChars: assistantText.length,
    chatId
  });

  return {
    assistantText,
    chatId,
    refreshedChat,
    ...(sources.length > 0 ? { sources } : {})
  };
}

export async function sendPersistedMessage({
  activeChat,
  client,
  delay = defaultDelay,
  diagnostics,
  idGenerator = defaultIdGenerator,
  now = Date.now,
  onContent,
  onEvent,
  realtimeFallbackPollDelayMs = 750,
  pollIntervalMs = 750,
  pollMaxAttempts = 80,
  prompt,
  realtimeClient,
  title,
  ...payloadInput
}: SendPersistedMessageInput): Promise<SendPersistedMessageResult> {
  diagnostics?.log("chat.send.start", {
    activeChat: Boolean(activeChat),
    modelId: payloadInput.modelId,
    promptLength: prompt.length
  });
  const userMessageId = idGenerator();
  const assistantMessageId = idGenerator();
  const fallbackSessionId = idGenerator();
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

  let assistantText = "";
  let contentSource: "http" | "poll" | "realtime" | undefined;
  let hasAnswerText = false;
  let hasHttpStreamText = false;
  let httpDone = false;
  let isReasoningOpen = false;
  let realtimeError: Error | undefined;
  let realtimeDone = false;
  let realtimeConnected = false;
  let sessionId = fallbackSessionId;
  let sources: CitationSource[] = [];
  const usesServerToolsOrFeatures =
    (payloadInput.toolIds?.length ?? 0) > 0 ||
    (payloadInput.filterIds?.length ?? 0) > 0 ||
    isOpenWebUINativeFunctionCallingModel(payloadInput.modelItem) ||
    Object.values(payloadInput.features ?? {}).some((value) => value === true);
  let unsubscribeRealtime: (() => void) | undefined;
  let resolveRealtimeDone: () => void = () => undefined;
  const realtimeDoneSignal = new Promise<void>((resolve) => {
    resolveRealtimeDone = resolve;
  });
  let resolveHttpDone: () => void = () => undefined;
  const httpDoneSignal = new Promise<void>((resolve) => {
    resolveHttpDone = resolve;
  });

  const applyEventFrom = (event: StreamEvent, source: "http" | "realtime") => {
    const contentLength =
      event.type === "content" || event.type === "reasoning" || event.type === "replace"
        ? event.content.length
        : undefined;
    diagnostics?.log("chat.stream.event", {
      ...(contentLength === undefined ? {} : { contentLength }),
      source,
      type: event.type
    });

    if (event.type === "done") {
      if (source === "realtime") {
        realtimeDone = true;
        resolveRealtimeDone();
      } else {
        httpDone = true;
        resolveHttpDone();
      }
      onEvent?.(event);
      diagnostics?.log("chat.stream.done", { source });
      return;
    }

    const isTextEvent =
      event.type === "content" || event.type === "reasoning" || event.type === "replace";
    const isAnswerEvent = event.type === "content" || event.type === "replace";

    if (usesServerToolsOrFeatures && isTextEvent) {
      diagnostics?.log("chat.stream.tool_text_ignored", {
        ...(contentLength === undefined ? {} : { contentLength }),
        source,
        type: event.type
      });
      return;
    }

    if (isTextEvent && contentSource && contentSource !== source) {
      diagnostics?.log("chat.stream.ignored_source", {
        currentSource: contentSource,
        ignoredSource: source,
        type: event.type
      });
      return;
    }

    if (isTextEvent) {
      if (!contentSource) {
        diagnostics?.log("chat.stream.first_text", { source });
      }
      contentSource = source;
      hasHttpStreamText ||= source === "http";
    }

    if (isAnswerEvent && event.content.trim()) {
      hasAnswerText = true;
    }

    const result = applyAssistantStreamEvent({
      assistantText,
      event,
      isReasoningOpen,
      onContent,
      onEvent,
      sources
    });
    assistantText = result.assistantText;
    isReasoningOpen = result.isReasoningOpen;
    sources = result.sources;
  };

  if (realtimeClient) {
    try {
      const realtimeConnection = await realtimeClient.connect();
      sessionId = realtimeConnection.sessionId || fallbackSessionId;
      realtimeConnected = true;
      diagnostics?.log("realtime.session.connected", { sessionId });
      unsubscribeRealtime = realtimeClient.onEvent((rawEvent) => {
        const parsed = parseOpenWebUIRealtimeEvent(rawEvent);

        if (!parsed) {
          diagnostics?.log("realtime.event.unparsed");
          return;
        }

        const matchesSession = parsed.sessionId === sessionId;
        const matchesChat = parsed.chatId === chatId;

        if (parsed.sessionId && !matchesSession) {
          diagnostics?.log("realtime.event.ignored_session", {
            eventSessionId: parsed.sessionId,
            sessionId
          });
          return;
        }

        if (!matchesSession && parsed.chatId && !matchesChat) {
          diagnostics?.log("realtime.event.ignored_chat", {
            chatId,
            eventChatId: parsed.chatId
          });
          return;
        }

        if (parsed.messageId && parsed.messageId !== assistantMessageId) {
          diagnostics?.log("realtime.event.ignored_message", {
            assistantMessageId,
            eventMessageId: parsed.messageId
          });
          return;
        }

        try {
          applyEventFrom(parsed.event, "realtime");
          if (parsed.done) {
            realtimeDone = true;
            resolveRealtimeDone();
          }
        } catch (error) {
          realtimeError = error instanceof Error ? error : new Error(String(error));
          diagnostics?.log("realtime.event.error", { errorName: realtimeError.name });
        }
      });
    } catch {
      diagnostics?.log("realtime.session.unavailable");
      realtimeClient.disconnect?.();
    }
  }

  const completionPayload = buildCompletionPayload({
    ...withDefaultPromptVariables(payloadInput, now),
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
  diagnostics?.log("chat.completion.request.start", {
    assistantMessageId,
    chatId,
    modelId: payloadInput.modelId,
    sessionId
  });

  if (payloadInput.isPipeModel || (!client.triggerChatCompletion && !realtimeClient)) {
    const stream = await client.streamChatCompletion(completionPayload);
    diagnostics?.log("http.stream.opened", { mode: "direct" });

    for await (const event of readStreamEvents(stream)) {
      applyEventFrom(event, "http");

      if (realtimeError) {
        throw realtimeError;
      }
    }
  } else {
    let completionError: Error | undefined;
    const completionPromise = client
      .streamChatCompletion(completionPayload)
      .then(async (stream) => {
        diagnostics?.log("http.stream.opened", { mode: "persisted" });
        for await (const event of readStreamEvents(stream)) {
          applyEventFrom(event, "http");
        }

        return {};
      })
      .catch((error: unknown) => {
        completionError = error instanceof Error ? error : new Error(String(error));
        diagnostics?.log("http.stream.error", { errorName: completionError.name });
        return {};
      })
      .finally(() => {
        httpDone = true;
        resolveHttpDone();
        diagnostics?.log("http.stream.closed");
      });

    void completionPromise;

    let refreshedDuringStream: ChatTree | undefined;
    let lastPersistedText = "";
    let stalePollCount = 0;
    const liveStreamHasText = () => hasAnswerText && (httpDone || realtimeDone);

    for (let attempt = 1; attempt <= pollMaxAttempts; attempt += 1) {
      if (completionError) {
        throw completionError;
      }

      if (realtimeError) {
        throw realtimeError;
      }

      if (liveStreamHasText()) {
        break;
      }

      const fallbackDelayMs =
        attempt > 1 || !realtimeConnected
          ? pollIntervalMs
          : realtimeFallbackPollDelayMs;
      diagnostics?.log("chat.poll.wait", {
        attempt,
        fallbackDelayMs,
        httpDone,
        realtimeConnected,
        realtimeDone
      });
      await Promise.race([httpDoneSignal, realtimeDoneSignal, delay(fallbackDelayMs)]);

      if (liveStreamHasText()) {
        break;
      }

      refreshedDuringStream = await client.getChat(chatId);
      const persistedText = getPersistedAssistantText(refreshedDuringStream, assistantMessageId);
      const persistedHasAnswerText = hasAssistantAnswerText(persistedText);
      const persistedMessage = refreshedDuringStream.messages[assistantMessageId];
      const isDone =
        isRecord(persistedMessage) && typeof persistedMessage.done === "boolean"
          ? persistedMessage.done
          : false;
      const canUsePersistedText =
        persistedText.trim() &&
        (!contentSource ||
          contentSource === "poll" ||
          !hasAnswerText ||
          (usesServerToolsOrFeatures &&
            persistedText !== assistantText &&
            (isDone || persistedText.startsWith(assistantText))));
      diagnostics?.log("chat.poll.response", {
        assistantMessageId,
        attempt,
        chatId,
        persistedLength: persistedText.length
      });

      if (canUsePersistedText) {
        if (!contentSource) {
          diagnostics?.log("chat.poll.first_content", {
            assistantMessageId,
            attempt,
            chatId,
            contentLength: persistedText.length
          });
          diagnostics?.log("chat.stream.first_text", { source: "poll" });
        } else if (contentSource !== "poll") {
          diagnostics?.log("chat.poll.takeover", {
            attempt,
            previousSource: contentSource,
            reason: isDone ? "persisted-done" : "persisted-extended",
            persistedLength: persistedText.length
          });
        }
        contentSource = "poll";
        if (isReasoningOpen) {
          const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
          assistantText = closed.assistantText;
          isReasoningOpen = closed.isReasoningOpen;
        }
        assistantText = emitPersistedDelta({ assistantText, onContent, persistedText });
        hasAnswerText ||= persistedHasAnswerText;

        if (persistedText.length > lastPersistedText.length) {
          lastPersistedText = persistedText;
          stalePollCount = 0;
        } else {
          stalePollCount += 1;
        }
      }

      sources = normalizeCitationSources([
        ...sources,
        ...getPersistedAssistantSources(refreshedDuringStream, assistantMessageId)
      ]);

      if (hasAnswerText && (isDone || stalePollCount >= 2)) {
        diagnostics?.log("chat.poll.stop", {
          attempt,
          isDone,
          stalePollCount
        });
        break;
      }
    }

    if (!httpDone && (contentSource === "http" || !assistantText.trim())) {
      await httpDoneSignal;
    }

    if (completionError) {
      throw completionError;
    }

    unsubscribeRealtime?.();
    realtimeClient?.disconnect?.();
  }

  const closed = closeReasoningBlock({ assistantText, isReasoningOpen, onContent });
  assistantText = closed.assistantText;

  let refreshedChat: ChatTree | undefined;
  const shouldPollPersistedText = !hasAnswerText;

  for (
    let attempt = 1;
    shouldPollPersistedText && attempt <= pollMaxAttempts;
    attempt += 1
  ) {
    refreshedChat = await client.getChat(chatId);
    const persistedText = getPersistedAssistantText(refreshedChat, assistantMessageId);
    const persistedHasAnswerText = hasAssistantAnswerText(persistedText);

    if (persistedText.trim()) {
      diagnostics?.log("chat.final_poll.content", {
        attempt,
        chatId,
        contentLength: persistedText.length
      });
      assistantText = emitPersistedDelta({ assistantText, onContent, persistedText });
      hasAnswerText ||= persistedHasAnswerText;
    }

    sources = normalizeCitationSources([
      ...sources,
      ...getPersistedAssistantSources(refreshedChat, assistantMessageId)
    ]);

    const persistedMessage = refreshedChat.messages[assistantMessageId];
    const isDone =
      isRecord(persistedMessage) && typeof persistedMessage.done === "boolean"
        ? persistedMessage.done
        : false;

    if (hasAnswerText && isDone) {
      break;
    }

    if (hasAnswerText && attempt >= 3) {
      break;
    }

    if (attempt < pollMaxAttempts) {
      await delay(pollIntervalMs);
    }
  }

  if (!hasAnswerText) {
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
      sources,
      timestamp: Math.floor(now() / 1000),
      userMessageId
    })
  });

  refreshedChat = await client.getChat(chatId);
  sources = normalizeCitationSources([
    ...sources,
    ...getPersistedAssistantSources(refreshedChat, assistantMessageId)
  ]);

  diagnostics?.log("chat.send.done", {
    assistantChars: assistantText.length,
    chatId,
    contentSource: contentSource ?? "final-poll"
  });

  return {
    assistantText,
    chatId,
    refreshedChat,
    ...(sources.length > 0 ? { sources } : {})
  };
}
