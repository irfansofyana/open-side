import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "./App";
import type { ChatSummary } from "../lib/openwebui/types";
import type {
  ConnectToServerResult,
  RestoreSavedConnectionResult
} from "../lib/runtime/connectionRuntime";

const connectionResult: ConnectToServerResult = {
  server: {
    id: "server-openwebui-example-com",
    baseUrl: "https://openwebui.example.com",
    displayName: "openwebui.example.com",
    createdAt: "2026-05-01T02:03:04.000Z",
    lastConnectedAt: "2026-05-01T02:03:04.000Z"
  },
  session: {
    serverId: "server-openwebui-example-com",
    token: "token-1",
    tokenType: "Bearer",
    user: {
      id: "user-1",
      email: "ada@example.com"
    }
  },
  models: [
    { id: "llama3.1", name: "Llama 3.1" },
    { id: "mistral" }
  ]
};

const emptyRestore = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
  status: "empty"
});

test("default connection form renders", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Connect server" })).toBeInTheDocument();
  expect(screen.getByLabelText("Server URL")).toBeInTheDocument();
  expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
});

test("startup restore hides credential form until saved session check finishes", async () => {
  let resolveRestore: (result: RestoreSavedConnectionResult) => void = () => undefined;
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>(
    () =>
      new Promise((resolve) => {
        resolveRestore = resolve;
      })
  );

  render(<App restoreConnection={restoreConnection} />);

  expect(screen.getByRole("heading", { name: "Restoring session" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Server URL")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();

  resolveRestore({ status: "empty" });

  expect(await screen.findByRole("heading", { name: "Connect server" })).toBeInTheDocument();
});

test("saved session restores ready state without asking for credentials", async () => {
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "mistral"
  });

  render(<App restoreConnection={restoreConnection} />);

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Model")).toHaveValue("mistral");
});

test("expired saved session prefills server and email and can forget the saved server", async () => {
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "loginRequired",
    server: connectionResult.server,
    email: "ada@example.com",
    message: "Open WebUI session expired. Please log in again."
  });
  const forgetSavedServer = vi.fn(async () => undefined);

  render(<App restoreConnection={restoreConnection} forgetSavedServer={forgetSavedServer} />);

  expect(await screen.findByLabelText("Server URL")).toHaveValue("https://openwebui.example.com");
  expect(screen.getByLabelText("Email or username")).toHaveValue("ada@example.com");
  expect(screen.getByLabelText("Password")).toHaveValue("");
  expect(screen.getByRole("alert")).toHaveTextContent("Open WebUI session expired");

  fireEvent.click(screen.getByRole("button", { name: "Forget saved server" }));

  await waitFor(() => {
    expect(forgetSavedServer).toHaveBeenCalledWith("server-openwebui-example-com");
  });
  expect(screen.getByLabelText("Server URL")).toHaveValue("");
  expect(screen.getByLabelText("Email or username")).toHaveValue("");
});

test("successful submit calls connect function with form values and renders ready state/models", async () => {
  const connect = vi.fn().mockResolvedValue(connectionResult);

  render(<App connect={connect} restoreConnection={emptyRestore} />);

  fireEvent.change(await screen.findByLabelText("Server URL"), {
    target: { value: "https://openwebui.example.com" }
  });
  fireEvent.change(screen.getByLabelText("Email or username"), {
    target: { value: "ada@example.com" }
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));

  expect(screen.getByRole("button", { name: "Authenticating..." })).toBeDisabled();
  await waitFor(() => {
    expect(connect).toHaveBeenCalledWith({
      serverUrl: "https://openwebui.example.com",
      email: "ada@example.com",
      password: "secret"
    });
  });
  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  expect(screen.getByText("openwebui.example.com")).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Llama 3.1" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "mistral" })).toBeInTheDocument();
  expect(screen.queryByDisplayValue("secret")).not.toBeInTheDocument();
});

test("failed submit renders error message", async () => {
  const connect = vi.fn().mockRejectedValue(new Error("Unable to connect"));

  render(<App connect={connect} restoreConnection={emptyRestore} />);

  fireEvent.change(await screen.findByLabelText("Server URL"), {
    target: { value: "https://openwebui.example.com" }
  });
  fireEvent.change(screen.getByLabelText("Email or username"), {
    target: { value: "ada@example.com" }
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "wrong" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Unable to connect");
});

test("connected user can send a prompt and see streamed assistant text", async () => {
  const connect = vi.fn().mockResolvedValue(connectionResult);
  const sendMessage = vi.fn(async ({ onContent, prompt }) => {
    onContent("Hello ");
    onContent("from Open WebUI");
    return {
      assistantText:
        prompt === "Say hello"
          ? "Hello from Open WebUI"
          : prompt === "Follow up"
            ? "Second answer"
            : "Fresh answer",
      chatId: prompt === "Fresh start" ? "chat-2" : "chat-1",
      refreshedChat: {
        id: prompt === "Fresh start" ? "chat-2" : "chat-1",
        title: "Active chat",
        messages: {}
      }
    };
  });

  render(<App connect={connect} restoreConnection={emptyRestore} sendMessage={sendMessage} />);

  fireEvent.change(await screen.findByLabelText("Server URL"), {
    target: { value: "https://openwebui.example.com" }
  });
  fireEvent.change(screen.getByLabelText("Email or username"), {
    target: { value: "ada@example.com" }
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Say hello" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        modelItem: { id: "llama3.1", name: "Llama 3.1" },
        modelId: "llama3.1",
        prompt: "Say hello"
      })
    );
  });
  expect(sendMessage.mock.calls[0]?.[0]).not.toHaveProperty("previousMessages");
  expect(screen.getByText("Say hello")).toBeInTheDocument();
  expect(await screen.findByText("Hello from Open WebUI")).toBeInTheDocument();
  expect(screen.getByLabelText("Message")).toHaveValue("");

  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Follow up" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });
  expect(sendMessage.mock.calls[1]?.[0]).toEqual(
    expect.objectContaining({
      activeChat: expect.objectContaining({ id: "chat-1" }),
      prompt: "Follow up"
    })
  );
  expect(await screen.findByText("Second answer")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Model"), {
    target: { value: "mistral" }
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Same chat, new model" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });
  expect(sendMessage.mock.calls[2]?.[0]).toEqual(
    expect.objectContaining({
      activeChat: expect.objectContaining({ id: "chat-1" }),
      modelId: "mistral",
      modelItem: { id: "mistral" },
      prompt: "Same chat, new model"
    })
  );

  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(screen.queryByText("Say hello")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Fresh start" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledTimes(4);
  });
  expect(sendMessage.mock.calls[3]?.[0]).toEqual(
    expect.not.objectContaining({
      activeChat: expect.anything()
    })
  );
  expect(await screen.findByText("Fresh answer")).toBeInTheDocument();
});

test("connected user can open recent chats, load one, and continue it", async () => {
  const recentChats: ChatSummary[] = [
    { id: "chat-recent", title: "Recent project chat", updatedAt: 1714528800 }
  ];
  const loadedChat = {
    id: "chat-recent",
    title: "Recent project chat",
    currentId: "assistant-1",
    messages: {
      "user-1": { id: "user-1", role: "user", content: "Earlier question" },
      "assistant-1": { id: "assistant-1", role: "assistant", content: "Earlier answer" }
    }
  };
  const connect = vi.fn().mockResolvedValue(connectionResult);
  const loadRecentChats = vi.fn(async () => recentChats);
  const loadChat = vi.fn(async () => ({
    chat: loadedChat,
    messages: [
      { id: "user-1", role: "user" as const, content: "Earlier question" },
      { id: "assistant-1", role: "assistant" as const, content: "Earlier answer" }
    ]
  }));
  const sendMessage = vi.fn(async ({ onContent }) => {
    onContent("Continued answer");
    return {
      assistantText: "Continued answer",
      chatId: "chat-recent",
      refreshedChat: loadedChat
    };
  });

  render(
    <App
      connect={connect}
      loadChat={loadChat}
      loadRecentChats={loadRecentChats}
      restoreConnection={emptyRestore}
      sendMessage={sendMessage}
    />
  );

  fireEvent.change(await screen.findByLabelText("Server URL"), {
    target: { value: "https://openwebui.example.com" }
  });
  fireEvent.change(screen.getByLabelText("Email or username"), {
    target: { value: "ada@example.com" }
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "secret" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Recent chats" }));

  expect(await screen.findByRole("button", { name: "Recent project chat" })).toBeInTheDocument();
  expect(loadRecentChats).toHaveBeenCalledWith(connectionResult);

  fireEvent.click(screen.getByRole("button", { name: "Recent project chat" }));

  expect(await screen.findByText("Earlier question")).toBeInTheDocument();
  expect(screen.getByText("Earlier answer")).toBeInTheDocument();
  expect(loadChat).toHaveBeenCalledWith(connectionResult, "chat-recent");

  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Continue this" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        activeChat: expect.objectContaining({ id: "chat-recent" }),
        prompt: "Continue this"
      })
    );
  });
  expect(await screen.findByText("Continued answer")).toBeInTheDocument();
});
