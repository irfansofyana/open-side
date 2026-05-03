import { io, type Socket } from "socket.io-client";

import { normalizeBaseUrl } from "./client";

type OpenWebUIRealtimeClientOptions = {
  baseUrl: string;
  connectTimeoutMs?: number;
  diagnostics?: {
    log: (event: string, fields?: Record<string, unknown>) => void;
  };
  token: string;
};

type SocketTransport = "polling" | "websocket";

export class OpenWebUIRealtimeClient {
  private readonly baseUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly diagnostics?: OpenWebUIRealtimeClientOptions["diagnostics"];
  private heartbeatId?: ReturnType<typeof setInterval>;
  private socket?: Socket;
  private readonly token: string;

  constructor({
    baseUrl,
    connectTimeoutMs = 10000,
    diagnostics,
    token
  }: OpenWebUIRealtimeClientOptions) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.connectTimeoutMs = connectTimeoutMs;
    this.diagnostics = diagnostics;
    this.token = token;
  }

  async connect(): Promise<{ sessionId: string }> {
    if (this.socket?.connected && this.socket.id) {
      return { sessionId: this.socket.id };
    }

    this.disconnect();

    try {
      return await this.connectWithTransports(["websocket"]);
    } catch {
      this.diagnostics?.log("realtime.connect.fallback", {
        from: "websocket",
        to: "polling,websocket"
      });
      this.disconnect();
      return this.connectWithTransports(["polling", "websocket"]);
    }
  }

  private connectWithTransports(transports: SocketTransport[]): Promise<{ sessionId: string }> {
    const transportLabel = transports.join(",");
    this.diagnostics?.log("realtime.connect.start", { transports: transportLabel });
    const socket = io(this.baseUrl, {
      auth: { token: this.token },
      path: "/ws/socket.io",
      randomizationFactor: 0.5,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports
    });
    this.socket = socket;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        this.diagnostics?.log("realtime.connect.timeout", { transports: transportLabel });
        reject(new Error("Open WebUI realtime connection timed out"));
      }, this.connectTimeoutMs);

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.off("connect", handleConnect);
        socket.off("connect_error", handleError);
      };

      const handleConnect = () => {
        cleanup();
        socket.emit("user-join", { auth: { token: this.token } });
        this.heartbeatId = setInterval(() => {
          if (socket.connected) {
            socket.emit("heartbeat", {});
          }
        }, 30000);
        this.diagnostics?.log("realtime.connect.ok", {
          sessionId: socket.id ?? "",
          transports: transportLabel
        });
        resolve({ sessionId: socket.id ?? "" });
      };

      const handleError = (error: Error) => {
        cleanup();
        this.diagnostics?.log("realtime.connect.error", {
          errorName: error.name,
          transports: transportLabel
        });
        reject(error);
      };

      socket.on("connect", handleConnect);
      socket.on("connect_error", handleError);
    });
  }

  onEvent(handler: (event: unknown) => void): () => void {
    const socket = this.socket;

    if (!socket) {
      return () => undefined;
    }

    const wrappedEventNames = new Set([
      "events",
      "chat-events",
      "events:channel",
      "channel-events"
    ]);
    const anyHandler = (eventName: string, payload: unknown) => {
      handler(wrappedEventNames.has(eventName) ? payload : { type: eventName, data: payload });
    };

    socket.onAny(anyHandler);

    return () => {
      socket.offAny(anyHandler);
    };
  }

  disconnect(): void {
    if (this.heartbeatId) {
      clearInterval(this.heartbeatId);
      this.heartbeatId = undefined;
    }

    this.socket?.disconnect();
    this.socket = undefined;
  }
}
