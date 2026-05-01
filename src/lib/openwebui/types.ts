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

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt?: number;
  pinned?: boolean;
  raw?: Record<string, unknown>;
}

export interface ChatTree {
  id: string;
  title: string;
  messages: Record<string, unknown>;
  currentId?: string;
  createdAt?: number;
  updatedAt?: number;
  pinned?: boolean;
  raw?: Record<string, unknown>;
}

export type ChatCompletionRequest = {
  stream: true;
  model: string;
  messages: Array<Record<string, unknown>>;
  chat_id?: string;
  session_id?: string;
  id?: string;
  parent_id?: string | null;
  user_message?: Record<string, unknown>;
  model_item?: Record<string, unknown>;
  tool_ids?: string[];
  filter_ids?: string[];
  features: FeatureFlags;
  params: Record<string, unknown>;
  variables: Record<string, unknown>;
  metadata: {
    variables: Record<string, unknown>;
  };
  stream_options: {
    include_usage: true;
  };
  background_tasks: Record<string, unknown>;
  tool_servers: Array<Record<string, unknown>>;
};

export type BuildCompletionPayloadInput = {
  modelId: string;
  messages: Array<Record<string, unknown>>;
  chatId?: string;
  sessionId?: string;
  assistantMessageId?: string;
  parentId?: string | null;
  userMessage?: Record<string, unknown>;
  modelItem?: Record<string, unknown>;
  toolIds?: string[];
  filterIds?: string[];
  features?: Partial<FeatureFlags>;
  params?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  backgroundTasks?: Record<string, unknown>;
  toolServers?: Array<Record<string, unknown>>;
  isPipeModel?: boolean;
};

export type StreamEvent =
  | { type: "content"; content: string }
  | { type: "status"; status: string; raw?: unknown }
  | { type: "usage"; usage: Record<string, unknown> }
  | { type: "error"; message: string; raw?: unknown }
  | { type: "done" };

export const defaultFeatureFlags: FeatureFlags = {
  web_search: false,
  image_generation: false,
  code_interpreter: false,
  memory: false
};
