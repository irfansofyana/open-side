import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { App } from "./App";
import type { ConnectToServerResult } from "../lib/runtime/connectionRuntime";

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

test("default connection form renders", () => {
  render(<App />);

  expect(screen.getByRole("heading", { name: "Connect server" })).toBeInTheDocument();
  expect(screen.getByLabelText("Server URL")).toBeInTheDocument();
  expect(screen.getByLabelText("Email or username")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
});

test("successful submit calls connect function with form values and renders ready state/models", async () => {
  const connect = vi.fn().mockResolvedValue(connectionResult);

  render(<App connect={connect} />);

  fireEvent.change(screen.getByLabelText("Server URL"), {
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

  render(<App connect={connect} />);

  fireEvent.change(screen.getByLabelText("Server URL"), {
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
  const sendMessage = vi.fn(async ({ onContent }) => {
    onContent("Hello ");
    onContent("from Open WebUI");
    return {
      assistantText: "Hello from Open WebUI",
      chatId: "chat-1",
      refreshedChat: {
        id: "chat-1",
        title: "Say hello",
        messages: {}
      }
    };
  });

  render(<App connect={connect} sendMessage={sendMessage} />);

  fireEvent.change(screen.getByLabelText("Server URL"), {
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
});
