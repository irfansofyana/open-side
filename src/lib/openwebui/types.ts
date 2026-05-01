export interface ServerRecord {
  id: string;
  baseUrl: string;
  displayName: string;
  createdAt: string;
  lastConnectedAt: string;
}

export interface OpenWebUIUser {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export type OpenWebUIErrorCode =
  | "ServerUnreachableError"
  | "NotOpenWebUIError"
  | "AuthFailedError"
  | "TokenExpiredError"
  | "ModelUnavailableError";

export class OpenWebUIError extends Error {
  readonly code: OpenWebUIErrorCode;
  readonly status?: number;

  constructor(code: OpenWebUIErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OpenWebUIError";
    this.code = code;
    this.status = status;
  }
}

export interface SessionRecord {
  serverId: string;
  token: string;
  tokenType: "Bearer";
  expiresAt?: string;
  user: OpenWebUIUser;
}

export interface FeatureFlags {
  web_search: boolean;
  image_generation: boolean;
  code_interpreter: boolean;
  memory: boolean;
}

export interface ServerPreferences {
  serverId: string;
  selectedModelId?: string;
  enabledToolIds: string[];
  enabledFeatures: FeatureFlags;
}

export interface ExtensionStorage {
  serversById: Record<string, ServerRecord>;
  sessionsByServerId: Record<string, SessionRecord>;
  preferencesByServerId: Record<string, ServerPreferences>;
  uiState: {
    activeServerId?: string;
    activeChatId?: string;
  };
}

export interface OpenWebUIModel {
  id: string;
  name?: string;
  object?: string;
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

export interface OpenWebUIModelDetail extends OpenWebUIModel {
  description?: string;
  capabilities?: Record<string, unknown>;
  info?: Record<string, unknown>;
}

export const defaultFeatureFlags: FeatureFlags = {
  web_search: false,
  image_generation: false,
  code_interpreter: false,
  memory: false
};
