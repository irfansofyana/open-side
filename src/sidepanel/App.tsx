import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import { Check, ChevronDown, History, Plus, Search, SendHorizontal } from "lucide-react";

import { MarkdownMessage } from "./MarkdownMessage";
import {
  forgetServerConnection,
  saveSelectedModelPreference as saveSelectedModelPreferenceToStorage
} from "../lib/chrome/storage";
import { OpenWebUIClient } from "../lib/openwebui/client";
import type { ChatSummary, ChatTree, OpenWebUIModel } from "../lib/openwebui/types";
import {
  connectToServer,
  restoreSavedConnection,
  type RestoreSavedConnectionResult,
  type ConnectToServerResult
} from "../lib/runtime/connectionRuntime";
import {
  listRecentChats,
  loadChatForDisplay,
  type LoadChatForDisplayResult,
  sendPersistedMessage,
  type SendPersistedMessageResult
} from "../lib/runtime/chatRuntime";

type AppProps = {
  connect?: (input: {
    serverUrl: string;
    email: string;
    password: string;
  }) => Promise<ConnectToServerResult>;
  forgetSavedServer?: (serverId: string) => Promise<unknown>;
  loadChat?: (connection: ConnectToServerResult, chatId: string) => Promise<LoadChatForDisplayResult>;
  loadRecentChats?: (connection: ConnectToServerResult) => Promise<ChatSummary[]>;
  restoreConnection?: () => Promise<RestoreSavedConnectionResult>;
  saveSelectedModelPreference?: (serverId: string, modelId: string) => Promise<unknown>;
  sendMessage?: (input: AppSendMessageInput) => Promise<SendPersistedMessageResult>;
};

type AppSendMessageInput = {
  activeChat?: ChatTree;
  connection: ConnectToServerResult;
  modelId: string;
  modelItem: OpenWebUIModel;
  prompt: string;
  onContent: (content: string) => void;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unable to connect";

const defaultSendMessage = ({
  activeChat,
  connection,
  modelItem,
  modelId,
  prompt,
  onContent
}: AppSendMessageInput): Promise<SendPersistedMessageResult> => {
  const client = new OpenWebUIClient({
    baseUrl: connection.server.baseUrl,
    getToken: () => connection.session.token
  });

  return sendPersistedMessage({
    activeChat,
    client,
    modelItem,
    modelId,
    prompt,
    onContent
  });
};

const createClient = (connection: ConnectToServerResult): OpenWebUIClient =>
  new OpenWebUIClient({
    baseUrl: connection.server.baseUrl,
    getToken: () => connection.session.token
  });

const promptShortcuts = [
  {
    label: "Summarize this page",
    prompt: "Summarize the current page."
  },
  {
    label: "Draft a reply",
    prompt: "Draft a clear, concise reply."
  },
  {
    label: "Explain this",
    prompt: "Explain this in simple terms."
  }
];

const getModelLabel = (model: OpenWebUIModel | undefined, fallbackId: string): string =>
  model?.name ?? model?.id ?? fallbackId;

type ModelPickerProps = {
  disabled?: boolean;
  models: OpenWebUIModel[];
  onSelect: (modelId: string) => void;
  selectedModelId: string;
};

function ModelPicker({ disabled = false, models, onSelect, selectedModelId }: ModelPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedModel = useMemo(
    () => models.find((model) => model.id === selectedModelId),
    [models, selectedModelId]
  );
  const selectedModelLabel = getModelLabel(selectedModel, selectedModelId || "Select model");
  const filteredModels = useMemo(() => {
    const query = deferredSearchTerm.trim().toLowerCase();

    if (!query) {
      return models;
    }

    return models.filter((model) => {
      const label = getModelLabel(model, model.id).toLowerCase();
      return label.includes(query) || model.id.toLowerCase().includes(query);
    });
  }, [deferredSearchTerm, models]);

  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus();
    }
  }, [isOpen]);

  const handleSelectModel = (modelId: string) => {
    onSelect(modelId);
    setSearchTerm("");
    setIsOpen(false);
  };

  return (
    <div className="model-picker">
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Model ${selectedModelLabel}`}
        className="model-picker-trigger"
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        title={selectedModelLabel}
        type="button"
      >
        <span className="model-picker-copy">
          <span className="model-picker-kicker">Model</span>
          <span className="model-picker-value">{selectedModelLabel}</span>
        </span>
        <ChevronDown aria-hidden="true" className="control-icon" />
      </button>

      {isOpen ? (
        <div
          className="model-popover"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setSearchTerm("");
              setIsOpen(false);
            }
          }}
        >
          <label className="model-search">
            <Search aria-hidden="true" className="control-icon" />
            <span className="sr-only">Search models</span>
            <input
              aria-label="Search models"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search models"
              ref={searchInputRef}
              type="search"
              value={searchTerm}
            />
          </label>
          <div className="model-list" role="listbox" aria-label="Models">
            {filteredModels.length > 0 ? (
              filteredModels.map((model) => {
                const modelLabel = getModelLabel(model, model.id);
                const isSelected = model.id === selectedModelId;

                return (
                  <button
                    aria-selected={isSelected}
                    className={`model-option${isSelected ? " model-option-selected" : ""}`}
                    key={model.id}
                    onClick={() => handleSelectModel(model.id)}
                    role="option"
                    type="button"
                  >
                    <span className="model-option-text">
                      <span className="model-option-name">{modelLabel}</span>
                      {model.id !== modelLabel ? (
                        <span className="model-option-id">{model.id}</span>
                      ) : null}
                    </span>
                    {isSelected ? <Check aria-hidden="true" className="control-icon" /> : null}
                  </button>
                );
              })
            ) : (
              <p className="model-empty">No matching models</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const defaultLoadRecentChats = (connection: ConnectToServerResult): Promise<ChatSummary[]> =>
  listRecentChats({
    client: createClient(connection)
  });

const defaultLoadChat = (
  connection: ConnectToServerResult,
  chatId: string
): Promise<LoadChatForDisplayResult> =>
  loadChatForDisplay({
    chatId,
    client: createClient(connection)
  });

const defaultSaveSelectedModelPreference = (
  serverId: string,
  modelId: string
): Promise<unknown> =>
  saveSelectedModelPreferenceToStorage({
    modelId,
    serverId
  });

export function App({
  connect = connectToServer,
  forgetSavedServer = forgetServerConnection,
  loadChat = defaultLoadChat,
  loadRecentChats = defaultLoadRecentChats,
  restoreConnection = restoreSavedConnection,
  saveSelectedModelPreference = defaultSaveSelectedModelPreference,
  sendMessage = defaultSendMessage
}: AppProps) {
  const [serverUrl, setServerUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [prompt, setPrompt] = useState("");
  const [selectedModelId, setSelectedModelId] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const [connection, setConnection] = useState<ConnectToServerResult>();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [activeChat, setActiveChat] = useState<ChatTree>();
  const [savedServerId, setSavedServerId] = useState<string>();
  const [isRestoring, setIsRestoring] = useState(true);
  const [isLoadingRecentChats, setIsLoadingRecentChats] = useState(false);
  const [isRecentChatsOpen, setIsRecentChatsOpen] = useState(false);
  const [recentChats, setRecentChats] = useState<ChatSummary[]>([]);

  useEffect(() => {
    let isMounted = true;

    restoreConnection()
      .then((result) => {
        if (!isMounted) {
          return;
        }

        if (result.status === "ready") {
          const preferredModelExists = result.connection.models.some(
            (model) => model.id === result.selectedModelId
          );

          setConnection(result.connection);
          setServerUrl(result.connection.server.baseUrl);
          setEmail(result.connection.session.user.email ?? "");
          setPassword("");
          setSelectedModelId(
            preferredModelExists
              ? result.selectedModelId ?? ""
              : result.connection.models[0]?.id ?? ""
          );
          setSavedServerId(result.connection.server.id);
          setErrorMessage(undefined);
          return;
        }

        if (result.status === "loginRequired") {
          setServerUrl(result.server.baseUrl);
          setEmail(result.email ?? "");
          setPassword("");
          setSavedServerId(result.server.id);
          setErrorMessage(result.message);
        }
      })
      .catch((error) => {
        if (isMounted) {
          setErrorMessage(getErrorMessage(error));
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsRestoring(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [restoreConnection]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsConnecting(true);
    setErrorMessage(undefined);

    try {
      const result = await connect({ serverUrl, email, password });
      setConnection(result);
      setSelectedModelId(result.models[0]?.id ?? "");
      setSavedServerId(result.server.id);
      setActiveChat(undefined);
      setChatMessages([]);
      setRecentChats([]);
      setIsRecentChatsOpen(false);
      setPassword("");
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsConnecting(false);
    }
  };

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!connection || !selectedModelId || !prompt.trim()) {
      return;
    }

    const nextPrompt = prompt;
    const assistantId = `assistant-${Date.now()}`;
    const modelItem =
      connection.models.find((model) => model.id === selectedModelId) ?? { id: selectedModelId };

    setPrompt("");
    setErrorMessage(undefined);
    setIsSending(true);
    setChatMessages((messages) => [
      ...messages,
      { id: `user-${Date.now()}`, role: "user", content: nextPrompt },
      { id: assistantId, role: "assistant", content: "" }
    ]);

    try {
      const result = await sendMessage({
        activeChat,
        connection,
        modelItem,
        modelId: selectedModelId,
        prompt: nextPrompt,
        onContent: (content) => {
          setChatMessages((messages) =>
            messages.map((message) =>
              message.id === assistantId
                ? { ...message, content: `${message.content}${content}` }
                : message
            )
          );
        }
      });

      setChatMessages((messages) =>
        messages.map((message) =>
          message.id === assistantId ? { ...message, content: result.assistantText } : message
        )
      );
      setActiveChat(result.refreshedChat);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
      setChatMessages((messages) => messages.filter((message) => message.id !== assistantId));
    } finally {
      setIsSending(false);
    }
  };

  const handleMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  };

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);

    if (!connection) {
      return;
    }

    saveSelectedModelPreference(connection.server.id, modelId).catch((error) => {
      setErrorMessage(getErrorMessage(error));
    });
  };

  const handleNewChat = () => {
    setActiveChat(undefined);
    setChatMessages([]);
    setIsRecentChatsOpen(false);
    setErrorMessage(undefined);
  };

  const handleRecentChats = async () => {
    if (!connection) {
      return;
    }

    if (isRecentChatsOpen) {
      setIsRecentChatsOpen(false);
      return;
    }

    setIsLoadingRecentChats(true);
    setErrorMessage(undefined);

    try {
      const chats = await loadRecentChats(connection);
      setRecentChats(chats);
      setIsRecentChatsOpen(true);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoadingRecentChats(false);
    }
  };

  const handleSelectRecentChat = async (chatId: string) => {
    if (!connection) {
      return;
    }

    setErrorMessage(undefined);
    setIsLoadingRecentChats(true);

    try {
      const result = await loadChat(connection, chatId);
      setActiveChat(result.chat);
      setChatMessages(result.messages);
      setIsRecentChatsOpen(false);
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoadingRecentChats(false);
    }
  };

  const handleForgetSavedServer = async () => {
    if (!savedServerId) {
      return;
    }

    await forgetSavedServer(savedServerId);
    setSavedServerId(undefined);
    setServerUrl("");
    setEmail("");
    setPassword("");
    setErrorMessage(undefined);
  };

  return (
    <main className="panel-shell">
      <header className="top-bar">
        <div className="brand-cluster">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Open WebUI</span>
        </div>
        {connection ? <span className="server-chip">{connection.server.displayName}</span> : null}
        {connection ? (
          <button
            className="top-bar-action icon-text-action"
            disabled={isLoadingRecentChats || isSending}
            onClick={handleRecentChats}
            type="button"
          >
            <History aria-hidden="true" className="control-icon" />
            {isLoadingRecentChats ? "Loading..." : "Recent chats"}
          </button>
        ) : null}
      </header>

      {connection ? (
        <>
          <section className="chat-shell" aria-label="Chat session">
            <h1 className="sr-only" id="ready-title">
              Ready
            </h1>
            {isRecentChatsOpen ? (
              <div className="recent-chat-panel">
                <p className="section-label">Recent chats</p>
                <div className="recent-chat-list" aria-label="Recent chats">
                  {recentChats.length > 0 ? (
                    recentChats.map((chat) => (
                      <button
                        aria-current={activeChat?.id === chat.id ? "true" : undefined}
                        className={`recent-chat-item${
                          activeChat?.id === chat.id ? " recent-chat-item-active" : ""
                        }`}
                        key={chat.id}
                        onClick={() => void handleSelectRecentChat(chat.id)}
                        type="button"
                      >
                        {chat.title}
                      </button>
                    ))
                  ) : (
                    <p className="server-name">No recent chats yet.</p>
                  )}
                </div>
              </div>
            ) : null}
            <div className="chat-toolbar" aria-label="Chat controls">
              <ModelPicker
                disabled={isSending}
                models={connection.models}
                onSelect={handleSelectModel}
                selectedModelId={selectedModelId}
              />
              <button
                className="secondary-action icon-text-action new-chat-action"
                disabled={isSending}
                onClick={handleNewChat}
                type="button"
              >
                <Plus aria-hidden="true" className="control-icon" />
                New chat
              </button>
            </div>

            <div className="message-list" role="log" aria-label="Messages" aria-live="polite">
              {chatMessages.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-title">Start a conversation</p>
                  <p className="empty-copy">
                    Pick a model, send a message, or use a shortcut to get moving.
                  </p>
                  <div className="prompt-shortcuts" aria-label="Prompt shortcuts">
                    {promptShortcuts.map((shortcut) => (
                      <button
                        className="prompt-shortcut"
                        key={shortcut.label}
                        onClick={() => setPrompt(shortcut.prompt)}
                        type="button"
                      >
                        {shortcut.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                chatMessages.map((message) => (
                  <article className={`message message-${message.role}`} key={message.id}>
                    <p className="message-role">
                      {message.role === "user" ? "You" : "Assistant"}
                    </p>
                    {message.role === "assistant" ? (
                      message.content ? (
                        <MarkdownMessage content={message.content} />
                      ) : (
                        <p className="message-status">Assistant is responding</p>
                      )
                    ) : (
                      <p className="message-content">{message.content}</p>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>

          <form className="composer" onSubmit={handleChatSubmit}>
            <label className="sr-only" htmlFor="message">
              Message
            </label>
            <div className="composer-card">
              <textarea
                className="message-input"
                id="message"
                name="message"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleMessageKeyDown}
                placeholder="Message Open WebUI"
                rows={1}
                value={prompt}
              />
              <div className="composer-footer">
                <span className="composer-hint">Enter to send • Shift+Enter for newline</span>
                <button
                  aria-label={isSending ? "Sending" : "Send"}
                  className="send-action"
                  disabled={isSending || !selectedModelId || !prompt.trim()}
                  type="submit"
                >
                  <SendHorizontal aria-hidden="true" className="control-icon" />
                </button>
              </div>
            </div>
            {errorMessage ? (
              <p className="error-message" role="alert">
                {errorMessage}
              </p>
            ) : null}
          </form>
        </>
      ) : isRestoring ? (
        <section className="connection-panel restore-panel" aria-labelledby="restore-session-title">
          <div className="loading-ring" aria-hidden="true" />
          <p className="eyebrow">Open WebUI</p>
          <h1 id="restore-session-title">Restoring session</h1>
          <p className="server-name" role="status">
            Checking saved session...
          </p>
        </section>
      ) : (
        <section className="connection-panel" aria-labelledby="connect-server-title">
          <p className="eyebrow">Server</p>
          <h1 id="connect-server-title">Connect server</h1>

          <form className="connection-form" onSubmit={handleSubmit}>
            <label className="field-label" htmlFor="server-url">
              Server URL
            </label>
            <input
              className="field-control"
              id="server-url"
              name="serverUrl"
              onChange={(event) => setServerUrl(event.target.value)}
              required
              type="url"
              value={serverUrl}
            />

            <label className="field-label" htmlFor="email">
              Email or username
            </label>
            <input
              autoComplete="username"
              className="field-control"
              id="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="text"
              value={email}
            />

            <label className="field-label" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="field-control"
              id="password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />

            {errorMessage ? (
              <p className="error-message" role="alert">
                {errorMessage}
              </p>
            ) : null}

            {savedServerId ? (
              <button
                className="secondary-action"
                onClick={handleForgetSavedServer}
                type="button"
              >
                Forget saved server
              </button>
            ) : null}

            <button type="submit" className="primary-action" disabled={isConnecting}>
              {isConnecting ? "Authenticating..." : "Connect"}
            </button>
          </form>
        </section>
      )}
    </main>
  );
}
