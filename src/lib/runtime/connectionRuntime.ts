import { requestServerOriginPermission } from "../chrome/permissions";
import { saveServerConnection } from "../chrome/storage";
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
