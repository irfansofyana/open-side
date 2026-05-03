import { beforeEach, expect, test, vi } from "vitest";

import { OpenWebUIRealtimeClient } from "./realtime";

const ioMock = vi.hoisted(() => vi.fn());

vi.mock("socket.io-client", () => ({
  io: ioMock
}));

type Handler = (...args: unknown[]) => void;

const createSocket = () => {
  const handlers = new Map<string, Handler>();
  const socket = {
    connected: false,
    disconnect: vi.fn(),
    emit: vi.fn(),
    id: "socket-1",
    off: vi.fn((event: string) => {
      handlers.delete(event);
    }),
    offAny: vi.fn(),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler);
    }),
    onAny: vi.fn(),
    trigger: (event: string, ...args: unknown[]) => {
      handlers.get(event)?.(...args);
    }
  };

  return socket;
};

beforeEach(() => {
  ioMock.mockReset();
});

test("OpenWebUIRealtimeClient forwards wrapped and direct socket events", async () => {
  const socket = createSocket();
  ioMock.mockReturnValue(socket);
  const client = new OpenWebUIRealtimeClient({
    baseUrl: "https://openwebui.example.com",
    token: "token-1"
  });
  const connectPromise = client.connect();

  socket.connected = true;
  socket.trigger("connect");
  await expect(connectPromise).resolves.toEqual({ sessionId: "socket-1" });

  const events: unknown[] = [];
  const unsubscribe = client.onEvent((event) => {
    events.push(event);
  });
  const anyHandler = socket.onAny.mock.calls[0]?.[0] as Handler | undefined;

  anyHandler?.("chat-events", {
    chat_id: "chat-1",
    data: { type: "chat:message:delta", data: { content: "wrapped" } }
  });
  anyHandler?.("chat:message:delta", { content: "direct" });

  expect(events).toEqual([
    {
      chat_id: "chat-1",
      data: { type: "chat:message:delta", data: { content: "wrapped" } }
    },
    {
      data: { content: "direct" },
      type: "chat:message:delta"
    }
  ]);

  unsubscribe();
  expect(socket.offAny).toHaveBeenCalledWith(anyHandler);
});

test("OpenWebUIRealtimeClient connects websocket-first like Open WebUI and falls back to polling", async () => {
  const websocketSocket = createSocket();
  const fallbackSocket = createSocket();
  ioMock.mockReturnValueOnce(websocketSocket).mockReturnValueOnce(fallbackSocket);
  const client = new OpenWebUIRealtimeClient({
    baseUrl: "https://openwebui.example.com",
    token: "token-1"
  });
  const connectPromise = client.connect();

  websocketSocket.trigger("connect_error", new Error("websocket blocked"));
  await vi.waitFor(() => {
    expect(ioMock).toHaveBeenCalledTimes(2);
  });
  fallbackSocket.connected = true;
  fallbackSocket.trigger("connect");

  await expect(connectPromise).resolves.toEqual({ sessionId: "socket-1" });
  expect(ioMock).toHaveBeenNthCalledWith(
    1,
    "https://openwebui.example.com",
    expect.objectContaining({
      path: "/ws/socket.io",
      transports: ["websocket"]
    })
  );
  expect(ioMock).toHaveBeenNthCalledWith(
    2,
    "https://openwebui.example.com",
    expect.objectContaining({
      path: "/ws/socket.io",
      transports: ["polling", "websocket"]
    })
  );
  expect(websocketSocket.disconnect).toHaveBeenCalled();
  expect(fallbackSocket.emit).toHaveBeenCalledWith("user-join", {
    auth: { token: "token-1" }
  });
});

test("OpenWebUIRealtimeClient logs websocket fallback without leaking the token", async () => {
  const websocketSocket = createSocket();
  const fallbackSocket = createSocket();
  const diagnostics = { log: vi.fn() };
  ioMock.mockReturnValueOnce(websocketSocket).mockReturnValueOnce(fallbackSocket);
  const client = new OpenWebUIRealtimeClient({
    baseUrl: "https://openwebui.example.com",
    diagnostics,
    token: "token-1"
  });
  const connectPromise = client.connect();

  websocketSocket.trigger("connect_error", new Error("websocket blocked"));
  await vi.waitFor(() => {
    expect(ioMock).toHaveBeenCalledTimes(2);
  });
  fallbackSocket.connected = true;
  fallbackSocket.trigger("connect");

  await expect(connectPromise).resolves.toEqual({ sessionId: "socket-1" });
  expect(diagnostics.log).toHaveBeenCalledWith("realtime.connect.start", {
    transports: "websocket"
  });
  expect(diagnostics.log).toHaveBeenCalledWith("realtime.connect.error", {
    errorName: "Error",
    transports: "websocket"
  });
  expect(diagnostics.log).toHaveBeenCalledWith("realtime.connect.fallback", {
    from: "websocket",
    to: "polling,websocket"
  });
  expect(diagnostics.log).toHaveBeenCalledWith("realtime.connect.ok", {
    sessionId: "socket-1",
    transports: "polling,websocket"
  });
  expect(JSON.stringify(diagnostics.log.mock.calls)).not.toContain("token-1");
});
