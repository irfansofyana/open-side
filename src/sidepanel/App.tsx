import { useEffect, useState, type FormEvent } from "react";

import { forgetServerConnection } from "../lib/chrome/storage";
import { OpenWebUIClient } from "../lib/openwebui/client";
import type { ChatTree, OpenWebUIModel } from "../lib/openwebui/types";
import {
  connectToServer,
  restoreSavedConnection,
  type RestoreSavedConnectionResult,
  type ConnectToServerResult
} from "../lib/runtime/connectionRuntime";
import {
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
  restoreConnection?: () => Promise<RestoreSavedConnectionResult>;
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

export function App({
  connect = connectToServer,
  forgetSavedServer = forgetServerConnection,
  restoreConnection = restoreSavedConnection,
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

  const handleNewChat = () => {
    setActiveChat(undefined);
    setChatMessages([]);
    setErrorMessage(undefined);
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
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Open WebUI</span>
      </header>

      {connection ? (
        <>
          <section className="connection-panel chat-panel" aria-labelledby="ready-title">
            <p className="eyebrow">Server</p>
            <h1 id="ready-title">Ready</h1>
            <p className="server-name">{connection.server.displayName}</p>
            <label className="field-label" htmlFor="model">
              Model
            </label>
            <div className="chat-controls">
              <select
                className="field-control"
                id="model"
                name="model"
                onChange={(event) => setSelectedModelId(event.target.value)}
                value={selectedModelId}
              >
                {connection.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name ?? model.id}
                  </option>
                ))}
              </select>
              <button
                className="secondary-action"
                disabled={isSending}
                onClick={handleNewChat}
                type="button"
              >
                New chat
              </button>
            </div>

            <div className="message-list" aria-live="polite">
              {chatMessages.map((message) => (
                <article className={`message message-${message.role}`} key={message.id}>
                  <p className="message-role">{message.role === "user" ? "You" : "Assistant"}</p>
                  <p className="message-content">
                    {message.content || (message.role === "assistant" ? "Thinking..." : "")}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <form className="composer" onSubmit={handleChatSubmit}>
            <label className="field-label" htmlFor="message">
              Message
            </label>
            <textarea
              className="field-control message-input"
              id="message"
              name="message"
              onChange={(event) => setPrompt(event.target.value)}
              value={prompt}
            />
            {errorMessage ? (
              <p className="error-message" role="alert">
                {errorMessage}
              </p>
            ) : null}
            <button
              type="submit"
              className="primary-action"
              disabled={isSending || !selectedModelId || !prompt.trim()}
            >
              {isSending ? "Sending..." : "Send"}
            </button>
          </form>
        </>
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
