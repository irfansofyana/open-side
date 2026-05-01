import {
  defaultFeatureFlags,
  type ExtensionStorage,
  type OpenWebUIUser,
  type ServerPreferences,
  type ServerRecord,
  type SessionRecord
} from "../openwebui/types";

const STORAGE_KEY = "extensionStorage";

type SaveServerConnectionInput = {
  server: ServerRecord;
  session: SessionRecord;
};

const emptyStorage = (): ExtensionStorage => ({
  serversById: {},
  sessionsByServerId: {},
  preferencesByServerId: {},
  uiState: {}
});

const normalizeStorage = (
  stored: Partial<ExtensionStorage> | undefined
): { storage: ExtensionStorage; didMigrate: boolean } => ({
  storage: {
    ...emptyStorage(),
    ...stored,
    serversById: stored?.serversById ?? {},
    sessionsByServerId: stored?.sessionsByServerId ?? {},
    preferencesByServerId: stored?.preferencesByServerId ?? {},
    uiState: stored?.uiState ?? {}
  },
  didMigrate:
    stored === undefined ||
    stored.serversById == null ||
    stored.sessionsByServerId == null ||
    stored.preferencesByServerId == null ||
    stored.uiState == null
});

const persistExtensionStorage = async (storage: ExtensionStorage): Promise<ExtensionStorage> => {
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
  return storage;
};

const defaultPreferencesForServer = (serverId: string): ServerPreferences => ({
  serverId,
  enabledToolIds: [],
  enabledFeatures: { ...defaultFeatureFlags }
});

const sanitizeServerRecord = (server: ServerRecord): ServerRecord => ({
  id: server.id,
  baseUrl: server.baseUrl,
  displayName: server.displayName,
  createdAt: server.createdAt,
  lastConnectedAt: server.lastConnectedAt
});

const sanitizeUser = (user: OpenWebUIUser): OpenWebUIUser => {
  const sanitizedUser: OpenWebUIUser = {};

  if (user.id !== undefined) {
    sanitizedUser.id = user.id;
  }
  if (user.name !== undefined) {
    sanitizedUser.name = user.name;
  }
  if (user.email !== undefined) {
    sanitizedUser.email = user.email;
  }
  if (user.role !== undefined) {
    sanitizedUser.role = user.role;
  }

  return sanitizedUser;
};

const sanitizeSessionRecord = (session: SessionRecord): SessionRecord => {
  const sanitizedSession: SessionRecord = {
    serverId: session.serverId,
    token: session.token,
    tokenType: session.tokenType,
    user: sanitizeUser(session.user)
  };

  if (session.expiresAt !== undefined) {
    sanitizedSession.expiresAt = session.expiresAt;
  }

  return sanitizedSession;
};

export const getExtensionStorage = async (): Promise<ExtensionStorage> => {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const { storage, didMigrate } = normalizeStorage(
    result[STORAGE_KEY] as Partial<ExtensionStorage> | undefined
  );

  if (didMigrate) {
    await persistExtensionStorage(storage);
  }

  return storage;
};

export const saveServerConnection = async ({
  server,
  session
}: SaveServerConnectionInput): Promise<ExtensionStorage> => {
  const storage = await getExtensionStorage();
  const sanitizedServer = sanitizeServerRecord(server);
  const sanitizedSession = sanitizeSessionRecord(session);
  const nextStorage: ExtensionStorage = {
    serversById: {
      ...storage.serversById,
      [server.id]: sanitizedServer
    },
    sessionsByServerId: {
      ...storage.sessionsByServerId,
      [server.id]: sanitizedSession
    },
    preferencesByServerId: {
      ...storage.preferencesByServerId,
      [server.id]: storage.preferencesByServerId[server.id] ?? defaultPreferencesForServer(server.id)
    },
    uiState: {
      ...storage.uiState,
      activeServerId: server.id
    }
  };

  return persistExtensionStorage(nextStorage);
};

export const clearServerSession = async (serverId: string): Promise<ExtensionStorage> => {
  const storage = await getExtensionStorage();
  const { [serverId]: _removedSession, ...sessionsByServerId } = storage.sessionsByServerId;
  const { [serverId]: _removedPreferences, ...preferencesByServerId } = storage.preferencesByServerId;
  const { activeServerId, activeChatId, ...otherUiState } = storage.uiState;
  const clearsActiveServer = activeServerId === serverId;

  const nextStorage: ExtensionStorage = {
    ...storage,
    sessionsByServerId,
    preferencesByServerId,
    uiState: clearsActiveServer
      ? otherUiState
      : {
          ...otherUiState,
          activeServerId,
          activeChatId
        }
  };

  return persistExtensionStorage(nextStorage);
};
