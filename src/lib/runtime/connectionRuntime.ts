import { requestServerOriginPermission } from "../chrome/permissions";
import { getExtensionStorage, saveServerConnection } from "../chrome/storage";
import { OpenWebUIClient, normalizeBaseUrl } from "../openwebui/client";
import {
  OpenWebUIError,
  type OpenWebUIModel,
  type OpenWebUIUser,
  type ServerRecord,
  type SessionRecord
} from "../openwebui/types";

type ConnectToServerInput = {
  serverUrl: string;
  email: string;
  password: string;
  now?: () => Date;
  requestPermission?: typeof requestServerOriginPermission;
  clientFactory?: OpenWebUIConnectionClientFactory;
};

export type ConnectToServerResult = {
  server: ServerRecord;
  session: SessionRecord;
  models: OpenWebUIModel[];
};

export type RestoreSavedConnectionResult =
  | {
      status: "empty";
    }
  | {
      status: "loginRequired";
      server: ServerRecord;
      email?: string;
      message?: string;
    }
  | {
      status: "ready";
      connection: ConnectToServerResult;
      selectedModelId?: string;
    };

export type OpenWebUIConnectionClient = {
  probeConfig: () => Promise<Record<string, unknown>>;
  signIn: (input: { email: string; password: string }) => Promise<{
    token: string;
    tokenType: "Bearer";
  }>;
  getCurrentUser: () => Promise<OpenWebUIUser>;
  getModels: () => Promise<OpenWebUIModel[]>;
};

export type OpenWebUIConnectionClientFactory = (options: {
  baseUrl: string;
  getToken: () => string | undefined | Promise<string | undefined>;
}) => OpenWebUIConnectionClient;

const defaultClientFactory: OpenWebUIConnectionClientFactory = (options) =>
  new OpenWebUIClient(options);

const createServerId = (host: string): string =>
  `server-${host.replace(/[^a-z0-9]/gi, "-")}`;

export const connectToServer = async ({
  serverUrl,
  email,
  password,
  now = () => new Date(),
  requestPermission = requestServerOriginPermission,
  clientFactory = defaultClientFactory
}: ConnectToServerInput): Promise<ConnectToServerResult> => {
  const baseUrl = normalizeBaseUrl(serverUrl);
  const permission = await requestPermission(baseUrl);

  if (!permission.granted) {
    throw new OpenWebUIError(
      "ServerUnreachableError",
      "Permission was not granted for the server origin"
    );
  }

  let token: string | undefined;
  const client = clientFactory({
    baseUrl,
    getToken: () => token
  });

  await client.probeConfig();
  const signInResult = await client.signIn({ email, password });
  token = signInResult.token;

  const user = await client.getCurrentUser();
  const models = await client.getModels();
  const timestamp = now().toISOString();
  const host = new URL(baseUrl).host;
  const server: ServerRecord = {
    id: createServerId(host),
    baseUrl,
    displayName: host,
    createdAt: timestamp,
    lastConnectedAt: timestamp
  };
  const session: SessionRecord = {
    serverId: server.id,
    token: signInResult.token,
    tokenType: signInResult.tokenType,
    user
  };

  await saveServerConnection({ server, session });

  return { server, session, models };
};

export const restoreSavedConnection = async ({
  now = () => new Date(),
  clientFactory = defaultClientFactory
}: {
  now?: () => Date;
  clientFactory?: OpenWebUIConnectionClientFactory;
} = {}): Promise<RestoreSavedConnectionResult> => {
  const storage = await getExtensionStorage();
  const activeServerId = storage.uiState.activeServerId;
  const server = activeServerId
    ? storage.serversById[activeServerId]
    : Object.values(storage.serversById)[0];

  if (!server) {
    return { status: "empty" };
  }

  const session = storage.sessionsByServerId[server.id];
  const email = typeof session?.user.email === "string" ? session.user.email : undefined;

  if (!session) {
    return {
      status: "loginRequired",
      server,
      email
    };
  }

  if (session.expiresAt && Date.parse(session.expiresAt) <= now().getTime()) {
    return {
      status: "loginRequired",
      server,
      email,
      message: "Open WebUI session expired. Please log in again."
    };
  }

  const client = clientFactory({
    baseUrl: server.baseUrl,
    getToken: () => session.token
  });

  try {
    const user = await client.getCurrentUser();
    const models = await client.getModels();
    const nextServer = {
      ...server,
      lastConnectedAt: now().toISOString()
    };
    const nextSession = {
      ...session,
      user
    };

    await saveServerConnection({ server: nextServer, session: nextSession });

    return {
      status: "ready",
      connection: {
        server: nextServer,
        session: nextSession,
        models
      },
      selectedModelId: storage.preferencesByServerId[server.id]?.selectedModelId
    };
  } catch (error) {
    if (error instanceof OpenWebUIError) {
      return {
        status: "loginRequired",
        server,
        email,
        message:
          error.code === "TokenExpiredError"
            ? "Open WebUI session expired. Please log in again."
            : error.message
      };
    }

    throw error;
  }
};
