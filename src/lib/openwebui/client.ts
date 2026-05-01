import {
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

  private async request(
    path: string,
    options: RequestInit & { auth: boolean; signIn?: boolean }
  ): Promise<unknown> {
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

    return readJson(response);
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
