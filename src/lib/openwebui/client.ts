import {
  type ChatCompletionRequest,
  type ChatSummary,
  type ChatTree,
  OpenWebUIError,
  type OpenWebUIModel,
  type OpenWebUIModelDetail,
  type OpenWebUIUser
} from "./types";

type ClientOptions = {
  baseUrl: string;
  getToken: () => string | undefined | Promise<string | undefined>;
};

type SignInInput = {
  email: string;
  password: string;
};

type SignInResult = {
  token: string;
  tokenType: "Bearer";
};

export const normalizeBaseUrl = (input: string): string => {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    throw new OpenWebUIError("ServerUnreachableError", "Invalid server URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenWebUIError("ServerUnreachableError", "Server URL must use http or https");
  }

  return url.toString().replace(/\/+$/, "");
};

const readJson = async (response: Response): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecordArray = (value: unknown): Record<string, unknown>[] => {
  const items = Array.isArray(value) ? value : isRecord(value) ? value.data : undefined;

  return Array.isArray(items) ? items.filter(isRecord) : [];
};

const normalizeChatSummary = (
  value: Record<string, unknown>,
  options: { pinnedFallback?: boolean } = {}
): ChatSummary => ({
  id: String(value.id),
  title: typeof value.title === "string" && value.title.length > 0 ? value.title : "Untitled chat",
  updatedAt: typeof value.updated_at === "number" ? value.updated_at : undefined,
  pinned: typeof value.pinned === "boolean" ? value.pinned : options.pinnedFallback,
  raw: value
});

const getMessages = (value: Record<string, unknown>): Record<string, unknown> => {
  const chat = isRecord(value.chat) ? value.chat : undefined;

  if (chat && isRecord(chat.messages)) {
    return chat.messages;
  }

  if (isRecord(value.messages)) {
    return value.messages;
  }

  return {};
};

const looksLikeOpenWebUIConfig = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);

  if (
    keys.some((key) => key.toLowerCase().includes("webui")) ||
    Object.values(value).some(
      (entry) => typeof entry === "string" && entry.toLowerCase().includes("open webui")
    )
  ) {
    return true;
  }

  return false;
};

export class OpenWebUIClient {
  private readonly baseUrl: string;
  private readonly getToken: ClientOptions["getToken"];

  constructor({ baseUrl, getToken }: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.getToken = getToken;
  }

  async probeConfig(): Promise<Record<string, unknown>> {
    const data = await this.request("/api/config", { auth: false });

    if (!looksLikeOpenWebUIConfig(data)) {
      throw new OpenWebUIError(
        "NotOpenWebUIError",
        "Server does not look like Open WebUI"
      );
    }

    return data;
  }

  async signIn({ email, password }: SignInInput): Promise<SignInResult> {
    const data = await this.request("/api/v1/auths/signin", {
      auth: false,
      body: JSON.stringify({ email, password }),
      headers: {
        "content-type": "application/json"
      },
      method: "POST",
      signIn: true
    });

    if (!isRecord(data)) {
      throw new OpenWebUIError("AuthFailedError", "Open WebUI authentication failed");
    }

    const token = data.token ?? data.access_token;

    if (typeof token !== "string" || token.length === 0) {
      throw new OpenWebUIError("AuthFailedError", "Open WebUI authentication failed");
    }

    return {
      token,
      tokenType: "Bearer"
    };
  }

  async getCurrentUser(): Promise<OpenWebUIUser> {
    const data = await this.request("/api/v1/auths/", { auth: true });

    return isRecord(data) ? data : {};
  }

  async getModels(): Promise<OpenWebUIModel[]> {
    const data = await this.request("/api/models", { auth: true });
    const models = Array.isArray(data) ? data : isRecord(data) ? data.data : undefined;

    return Array.isArray(models) ? (models as OpenWebUIModel[]) : [];
  }

  async getModelDetail(modelId: string): Promise<OpenWebUIModelDetail> {
    const data = await this.request(
      `/api/v1/models/model?id=${encodeURIComponent(modelId)}`,
      { auth: true }
    );

    return isRecord(data) ? (data as OpenWebUIModelDetail) : { id: modelId };
  }

  async getChats(
    options: { page?: number; includePinned?: boolean } = {}
  ): Promise<ChatSummary[]> {
    const page = options.page ?? 1;
    const includePinned = options.includePinned ?? true;
    const data = await this.request(
      `/api/v1/chats/?page=${page}&include_folders=false&include_pinned=${includePinned}`,
      { auth: true }
    );

    return asRecordArray(data).map((chat) => normalizeChatSummary(chat));
  }

  async getPinnedChats(): Promise<ChatSummary[]> {
    const data = await this.request("/api/v1/chats/pinned", { auth: true });

    return asRecordArray(data).map((chat) =>
      normalizeChatSummary(chat, { pinnedFallback: true })
    );
  }

  async getChat(chatId: string): Promise<ChatTree> {
    const data = await this.request(`/api/v1/chats/${encodeURIComponent(chatId)}`, {
      auth: true
    });
    const chat = isRecord(data) ? data : {};
    const nestedChat = isRecord(chat.chat) ? chat.chat : undefined;

    return {
      id: typeof chat.id === "string" ? chat.id : chatId,
      title: typeof chat.title === "string" && chat.title.length > 0 ? chat.title : "Untitled chat",
      messages: getMessages(chat),
      currentId:
        nestedChat && typeof nestedChat.currentId === "string" ? nestedChat.currentId : undefined,
      createdAt: typeof chat.created_at === "number" ? chat.created_at : undefined,
      updatedAt: typeof chat.updated_at === "number" ? chat.updated_at : undefined,
      pinned: typeof chat.pinned === "boolean" ? chat.pinned : undefined,
      raw: chat
    };
  }

  async streamChatCompletion(
    payload: ChatCompletionRequest
  ): Promise<ReadableStream<Uint8Array>> {
    const response = await this.rawRequest("/api/chat/completions", {
      auth: true,
      body: JSON.stringify(payload),
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    });

    if (!response.body) {
      throw new OpenWebUIError(
        "ServerUnreachableError",
        "Open WebUI did not return a stream"
      );
    }

    return response.body;
  }

  private async request(
    path: string,
    options: RequestInit & { auth: boolean; signIn?: boolean }
  ): Promise<unknown> {
    const response = await this.rawRequest(path, options);

    return readJson(response);
  }

  private async rawRequest(
    path: string,
    options: RequestInit & { auth: boolean; signIn?: boolean }
  ): Promise<Response> {
    const { auth, signIn, ...requestOptions } = options;
    const headers = await this.buildHeaders(requestOptions.headers, auth);
    let response: Response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...requestOptions,
        headers,
        method: requestOptions.method ?? "GET"
      });
    } catch {
      throw new OpenWebUIError(
        "ServerUnreachableError",
        "Unable to reach Open WebUI server"
      );
    }

    if (!response.ok) {
      if (signIn) {
        throw new OpenWebUIError(
          "AuthFailedError",
          "Open WebUI authentication failed",
          response.status
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new OpenWebUIError(
          "TokenExpiredError",
          "Open WebUI session expired",
          response.status
        );
      }

      throw new OpenWebUIError(
        "ServerUnreachableError",
        "Open WebUI request failed",
        response.status
      );
    }

    return response;
  }

  private async buildHeaders(
    headers: RequestInit["headers"],
    includeAuth: boolean
  ): Promise<Record<string, string> | undefined> {
    const nextHeaders: Record<string, string> = {};

    if (headers instanceof Headers) {
      headers.forEach((value, key) => {
        nextHeaders[key] = value;
      });
    } else if (Array.isArray(headers)) {
      headers.forEach(([key, value]) => {
        nextHeaders[key] = value;
      });
    } else if (headers) {
      Object.assign(nextHeaders, headers);
    }

    if (includeAuth) {
      const token = await this.getToken();

      if (token) {
        nextHeaders.authorization = `Bearer ${token}`;
      }
    }

    return Object.keys(nextHeaders).length > 0 ? nextHeaders : undefined;
  }
}
