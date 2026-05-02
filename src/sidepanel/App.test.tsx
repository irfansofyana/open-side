import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { App } from "./App";
import type {
  BrowserTabSummary,
  CapturedTabContext,
  ChatSummary,
  ToolMenuItem
} from "../lib/openwebui/types";
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
    { id: "mistral" },
    { id: "openrouter.anthropic/claude-haiku-4.5", name: "Anthropic: Claude Haiku 4.5" },
    { id: "kimi-k2.6:cloud", name: "kimi-k2.6:cloud" }
  ]
};

const emptyRestore = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
  status: "empty"
});

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    },
    ...init
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
  expect(screen.getByRole("status")).toHaveTextContent("Checking saved session");
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
  expect(screen.getByLabelText(/Model/)).toHaveTextContent("mistral");
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
  expect(screen.getByLabelText(/Model/)).toHaveTextContent("Llama 3.1");
  expect(screen.queryByDisplayValue("secret")).not.toBeInTheDocument();
});

test("ready state uses a focused chat shell with empty prompt shortcuts", async () => {
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });

  render(<App restoreConnection={restoreConnection} />);

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Chat session" })).toBeInTheDocument();
  expect(screen.getByRole("log", { name: "Messages" })).toBeInTheDocument();
  expect(screen.getByText("Start a conversation")).toBeInTheDocument();
  expect(screen.getByLabelText(/Model/)).toHaveAttribute("title", "Llama 3.1");

  fireEvent.click(screen.getByRole("button", { name: "Summarize this page" }));

  expect(screen.getByLabelText("Message")).toHaveValue("Summarize the current page.");
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

  fireEvent.click(screen.getByLabelText(/Model/));
  fireEvent.click(await screen.findByRole("option", { name: /mistral/ }));
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

test("assistant messages render returned citation sources", async () => {
  const connect = vi.fn().mockResolvedValue(connectionResult);
  const sendMessage = vi.fn(async ({ onContent }) => {
    onContent("The minister is Purbaya [1].");
    return {
      assistantText: "The minister is Purbaya [1].",
      chatId: "chat-1",
      refreshedChat: {
        id: "chat-1",
        title: "Active chat",
        messages: {}
      },
      sources: [
        {
          documents: ["Reuters reported the appointment from Jakarta."],
          index: 1,
          metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
          name: "Reuters",
          url: "https://example.com/reuters"
        }
      ]
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
    target: { value: "Who is the minister?" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByRole("button", { name: "Reuters citation 1" })).toHaveTextContent("1");
  expect(screen.getByRole("button", { name: "Show 1 Source" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Show 1 Source" }));
  fireEvent.click(screen.getByRole("button", { name: "Open source 1: Reuters" }));

  expect(screen.getByRole("heading", { name: "Reuters" })).toBeInTheDocument();
  expect(screen.getByText("Reuters reported the appointment from Jakarta.")).toBeInTheDocument();
});

test("composer submits with Enter and keeps Shift Enter for multiline prompts", async () => {
  const connect = vi.fn().mockResolvedValue(connectionResult);
  const sendMessage = vi.fn(async ({ onContent }) => {
    onContent("ok");
    return {
      assistantText: "ok",
      chatId: "chat-1",
      refreshedChat: {
        id: "chat-1",
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

  const messageInput = screen.getByLabelText("Message");
  fireEvent.change(messageInput, { target: { value: "Line one" } });
  fireEvent.keyDown(messageInput, { key: "Enter", shiftKey: true });

  expect(sendMessage).not.toHaveBeenCalled();

  fireEvent.change(messageInput, { target: { value: "Line one\nLine two" } });
  fireEvent.keyDown(messageInput, { key: "Enter" });

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Line one\nLine two"
      })
    );
  });
});

test("model picker searches and selects from a long model list", async () => {
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });

  render(<App restoreConnection={restoreConnection} />);

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText(/Model/));
  fireEvent.change(screen.getByLabelText("Search models"), {
    target: { value: "haiku" }
  });

  expect(screen.queryByRole("option", { name: /Llama 3.1/ })).not.toBeInTheDocument();
  fireEvent.click(
    await screen.findByRole("option", { name: /Anthropic: Claude Haiku 4.5/ })
  );

  expect(screen.getByLabelText(/Model/)).toHaveTextContent("Anthropic: Claude Haiku 4.5");
});

test("model picker selection is saved as the default model for the server", async () => {
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });
  const saveSelectedModelPreference = vi.fn(async () => undefined);

  render(
    <App
      restoreConnection={restoreConnection}
      saveSelectedModelPreference={saveSelectedModelPreference}
    />
  );

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText(/Model/));
  fireEvent.click(await screen.findByRole("option", { name: /kimi-k2.6:cloud/ }));

  await waitFor(() => {
    expect(saveSelectedModelPreference).toHaveBeenCalledWith(
      "server-openwebui-example-com",
      "kimi-k2.6:cloud"
    );
  });
});

test("empty assistant message shows an intentional streaming state", async () => {
  let resolveSend: (value: {
    assistantText: string;
    chatId: string;
    refreshedChat: { id: string; title: string; messages: Record<string, unknown> };
  }) => void = () => undefined;
  const connect = vi.fn().mockResolvedValue(connectionResult);
  const sendMessage = vi.fn(
    () =>
      new Promise<{
        assistantText: string;
        chatId: string;
        refreshedChat: { id: string; title: string; messages: Record<string, unknown> };
      }>((resolve) => {
        resolveSend = resolve;
      })
  );

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
    target: { value: "Think slowly" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  expect(await screen.findByText("Assistant is responding")).toBeInTheDocument();

  resolveSend({
    assistantText: "Done",
    chatId: "chat-1",
    refreshedChat: { id: "chat-1", title: "Active chat", messages: {} }
  });

  expect(await screen.findByText("Done")).toBeInTheDocument();
});

test("connected user automatically attaches the current tab and manually selects other tabs", async () => {
  const currentTab: BrowserTabSummary = {
    favIconUrl: "https://example.com/favicon.ico",
    id: 101,
    isActive: true,
    origin: "https://example.com",
    title: "Example Docs",
    url: "https://example.com/docs"
  };
  const otherTab: BrowserTabSummary = {
    id: 102,
    isActive: false,
    origin: "https://other.example",
    title: "Other Docs",
    url: "https://other.example/docs"
  };
  const capturedCurrentTab: CapturedTabContext = {
    ...currentTab,
    readableText: "Page body",
    readableTextUnavailable: false,
    selectedText: "Selected paragraph",
    truncated: false
  };
  const capturedOtherTab: CapturedTabContext = {
    ...otherTab,
    readableText: "Other page body",
    readableTextUnavailable: false,
    selectedText: "",
    truncated: false
  };
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });
  const listTabs = vi.fn(async () => [currentTab, otherTab]);
  const captureTab = vi.fn(async (tab: BrowserTabSummary) =>
    tab.id === currentTab.id ? capturedCurrentTab : capturedOtherTab
  );

  render(<App captureTab={captureTab} listTabs={listTabs} restoreConnection={restoreConnection} />);

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add tabs" }));

  const tabsPicker = await screen.findByLabelText("Browser tabs");
  expect(within(tabsPicker).getByRole("button", { name: /Remove Example Docs/ })).toBeInTheDocument();
  expect(within(tabsPicker).getByRole("button", { name: /Share Other Docs/ })).toBeInTheDocument();
  expect(listTabs).toHaveBeenCalled();
  expect(captureTab).toHaveBeenCalledWith(currentTab);
  expect(captureTab).not.toHaveBeenCalledWith(otherTab);
  expect(screen.getByText("Sharing 1 tab")).toBeInTheDocument();
  expect(screen.getByText("Example Docs")).toBeInTheDocument();

  fireEvent.click(within(tabsPicker).getByRole("button", { name: /Share Other Docs/ }));

  await waitFor(() => {
    expect(captureTab).toHaveBeenCalledWith(otherTab);
  });
  expect(screen.getByText("Sharing 2 tabs")).toBeInTheDocument();
  expect(screen.getByText("Other Docs")).toBeInTheDocument();
});

test("selected browser tab context is injected into the sent prompt and cleared after send", async () => {
  const tab: BrowserTabSummary = {
    id: 101,
    isActive: true,
    origin: "https://example.com",
    title: "Example Docs",
    url: "https://example.com/docs"
  };
  const capturedTab: CapturedTabContext = {
    ...tab,
    readableText: "Page body",
    readableTextUnavailable: false,
    selectedText: "Selected paragraph",
    truncated: false
  };
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });
  const sendMessage = vi.fn(async ({ onContent }) => {
    onContent("ok");
    return {
      assistantText: "ok",
      chatId: "chat-1",
      refreshedChat: {
        id: "chat-1",
        title: "Active chat",
        messages: {}
      }
    };
  });

  render(
    <App
      captureTab={vi.fn(async () => capturedTab)}
      listTabs={vi.fn(async () => [tab])}
      restoreConnection={restoreConnection}
      sendMessage={sendMessage}
    />
  );

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Add tabs" }));
  expect(await screen.findByText("Sharing 1 tab")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Summarize this" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("Context from selected browser tabs:"),
        title: "Summarize this"
      })
    );
  });
  expect(sendMessage.mock.calls[0]?.[0].prompt).toContain("Title: Example Docs");
  expect(sendMessage.mock.calls[0]?.[0].prompt).toContain("Selected paragraph");
  expect(sendMessage.mock.calls[0]?.[0].prompt).toContain("User prompt:\nSummarize this");
  expect(screen.getByText("Summarize this")).toBeInTheDocument();
  expect(screen.queryByText("Sharing 1 tab")).not.toBeInTheDocument();
});

test("connected user can enable tools and feature toggles for the next chat request", async () => {
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });
  const toolMenu: ToolMenuItem[] = [
    {
      id: "search_tool",
      name: "Search Tool",
      description: "Search the web",
      kind: "tool",
      isEnabledByDefault: false
    },
    {
      id: "web_search",
      name: "Web search",
      kind: "builtin",
      featureKey: "web_search",
      isEnabledByDefault: false
    }
  ];
  const loadTools = vi.fn(async () => toolMenu);
  const sendMessage = vi.fn(async ({ onContent }) => {
    onContent("tool ok");
    return {
      assistantText: "tool ok",
      chatId: "chat-tools",
      refreshedChat: {
        id: "chat-tools",
        title: "Tool chat",
        messages: {}
      }
    };
  });

  render(
    <App
      loadTools={loadTools}
      restoreConnection={restoreConnection}
      sendMessage={sendMessage}
    />
  );

  expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tools" }));

  const toolsMenu = await screen.findByLabelText("Tools menu");
  expect(within(toolsMenu).getByText("Search the web")).toBeInTheDocument();
  fireEvent.click(within(toolsMenu).getByRole("button", { name: /Enable Search Tool/ }));
  fireEvent.click(within(toolsMenu).getByRole("button", { name: /Enable Web search/ }));

  expect(screen.getByText("Using 2 tools")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: "Use tools" }
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => {
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        features: expect.objectContaining({ web_search: true }),
        filterIds: [],
        modelId: "llama3.1",
        prompt: "Use tools",
        toolIds: ["search_tool"]
      })
    );
  });
});

test("default tools loader includes web search when Open WebUI config enables it", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(jsonResponse([]))
    .mockResolvedValueOnce(jsonResponse([]))
    .mockResolvedValueOnce(jsonResponse({ features: { enable_web_search: true } }));
  const restoreConnection = vi.fn<() => Promise<RestoreSavedConnectionResult>>().mockResolvedValue({
    status: "ready",
    connection: connectionResult,
    selectedModelId: "llama3.1"
  });

  vi.stubGlobal("fetch", fetchMock);

  try {
    render(<App restoreConnection={restoreConnection} />);

    expect(await screen.findByRole("heading", { name: "Ready" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tools" }));

    const toolsMenu = await screen.findByLabelText("Tools menu");
    expect(within(toolsMenu).getByRole("button", { name: /Enable Web search/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("https://openwebui.example.com/api/config", {
      headers: {
        authorization: "Bearer token-1"
      },
      method: "GET"
    });
  } finally {
    vi.stubGlobal("fetch", originalFetch);
  }
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

  fireEvent.click(screen.getByRole("button", { name: "Recent chats" }));

  expect(await screen.findByRole("button", { name: "Recent project chat" })).toHaveAttribute(
    "aria-current",
    "true"
  );

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
