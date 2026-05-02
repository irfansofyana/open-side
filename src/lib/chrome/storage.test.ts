import { setChromeStorageData } from "../../test/chromeMock";
import { defaultFeatureFlags } from "../openwebui/types";
import {
  clearServerSession,
  forgetServerConnection,
  getExtensionStorage,
  saveSelectedModelPreference,
  saveServerConnection
} from "./storage";

const server = {
  id: "server-1",
  baseUrl: "https://openwebui.example",
  displayName: "Open WebUI",
  createdAt: "2026-05-01T01:00:00.000Z",
  lastConnectedAt: "2026-05-01T01:05:00.000Z"
};

const session = {
  serverId: server.id,
  token: "token-1",
  tokenType: "Bearer" as const,
  expiresAt: "2026-05-02T01:05:00.000Z",
  user: {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    role: "admin"
  }
};

test("empty storage returns complete shape", async () => {
  await expect(getExtensionStorage()).resolves.toEqual({
    serversById: {},
    sessionsByServerId: {},
    preferencesByServerId: {},
    uiState: {}
  });
});

test("saving server connection stores server, session, default preferences, and active server", async () => {
  const stored = await saveServerConnection({ server, session });

  expect(stored).toEqual({
    serversById: {
      [server.id]: server
    },
    sessionsByServerId: {
      [server.id]: session
    },
    preferencesByServerId: {
      [server.id]: {
        serverId: server.id,
        enabledToolIds: [],
        enabledFeatures: defaultFeatureFlags
      }
    },
    uiState: {
      activeServerId: server.id
    }
  });
});

test("saving a second connection for same server preserves existing preferences", async () => {
  setChromeStorageData({
    extensionStorage: {
      serversById: {},
      sessionsByServerId: {},
      preferencesByServerId: {
        [server.id]: {
          serverId: server.id,
          selectedModelId: "llama3.1",
          enabledToolIds: ["web_search"],
          enabledFeatures: {
            ...defaultFeatureFlags,
            web_search: true
          }
        }
      },
      uiState: {}
    }
  });

  const stored = await saveServerConnection({ server, session });

  expect(stored.preferencesByServerId[server.id]).toEqual({
    serverId: server.id,
    selectedModelId: "llama3.1",
    enabledToolIds: ["web_search"],
    enabledFeatures: {
      ...defaultFeatureFlags,
      web_search: true
    }
  });
});

test("saving selected model preference persists it per server and preserves other preferences", async () => {
  setChromeStorageData({
    extensionStorage: {
      serversById: {
        [server.id]: server
      },
      sessionsByServerId: {
        [server.id]: session
      },
      preferencesByServerId: {
        [server.id]: {
          serverId: server.id,
          selectedModelId: "llama3.1",
          enabledToolIds: ["web_search"],
          enabledFeatures: {
            ...defaultFeatureFlags,
            web_search: true
          }
        }
      },
      uiState: {
        activeServerId: server.id
      }
    }
  });

  const stored = await saveSelectedModelPreference({
    modelId: "openrouter.anthropic/claude-haiku-4.5",
    serverId: server.id
  });

  expect(stored.preferencesByServerId[server.id]).toEqual({
    serverId: server.id,
    selectedModelId: "openrouter.anthropic/claude-haiku-4.5",
    enabledToolIds: ["web_search"],
    enabledFeatures: {
      ...defaultFeatureFlags,
      web_search: true
    }
  });
});

test("saving server connection does not persist extra server, session, or user fields", async () => {
  const serverWithExtraFields = {
    ...server,
    password: "server-password",
    internalOnly: true
  };
  const sessionWithExtraFields = {
    ...session,
    password: "session-password",
    refreshToken: "refresh-token",
    user: {
      ...session.user,
      password: "user-password",
      locale: "en-US"
    }
  };

  const stored = await saveServerConnection({
    server: serverWithExtraFields,
    session: sessionWithExtraFields
  });

  expect(stored.serversById[server.id]).toEqual(server);
  expect(stored.sessionsByServerId[server.id]).toEqual({
    ...session,
    user: session.user
  });
});

test("clearServerSession removes session and preferences, preserves server, and clears active ui state", async () => {
  setChromeStorageData({
    extensionStorage: {
      serversById: {
        [server.id]: server
      },
      sessionsByServerId: {
        [server.id]: session
      },
      preferencesByServerId: {
        [server.id]: {
          serverId: server.id,
          enabledToolIds: ["web_search"],
          enabledFeatures: {
            ...defaultFeatureFlags,
            web_search: true
          }
        }
      },
      uiState: {
        activeServerId: server.id,
        activeChatId: "chat-1"
      }
    }
  });

  const stored = await clearServerSession(server.id);

  expect(stored).toEqual({
    serversById: {
      [server.id]: server
    },
    sessionsByServerId: {},
    preferencesByServerId: {},
    uiState: {}
  });
});

test("clearServerSession preserves ui state when clearing an inactive server", async () => {
  const otherServerId = "server-2";
  setChromeStorageData({
    extensionStorage: {
      serversById: {
        [server.id]: server
      },
      sessionsByServerId: {
        [server.id]: session,
        [otherServerId]: {
          ...session,
          serverId: otherServerId
        }
      },
      preferencesByServerId: {
        [server.id]: {
          serverId: server.id,
          enabledToolIds: [],
          enabledFeatures: defaultFeatureFlags
        },
        [otherServerId]: {
          serverId: otherServerId,
          enabledToolIds: ["web_search"],
          enabledFeatures: {
            ...defaultFeatureFlags,
            web_search: true
          }
        }
      },
      uiState: {
        activeServerId: server.id,
        activeChatId: "chat-1"
      }
    }
  });

  const stored = await clearServerSession(otherServerId);

  expect(stored.sessionsByServerId).toEqual({
    [server.id]: session
  });
  expect(stored.preferencesByServerId).toEqual({
    [server.id]: {
      serverId: server.id,
      enabledToolIds: [],
      enabledFeatures: defaultFeatureFlags
    }
  });
  expect(stored.uiState).toEqual({
    activeServerId: server.id,
    activeChatId: "chat-1"
  });
});

test("forgetServerConnection removes server, session, preferences, and active ui state", async () => {
  setChromeStorageData({
    extensionStorage: {
      serversById: {
        [server.id]: server
      },
      sessionsByServerId: {
        [server.id]: session
      },
      preferencesByServerId: {
        [server.id]: {
          serverId: server.id,
          enabledToolIds: [],
          enabledFeatures: defaultFeatureFlags
        }
      },
      uiState: {
        activeServerId: server.id,
        activeChatId: "chat-1"
      }
    }
  });

  const stored = await forgetServerConnection(server.id);

  expect(stored).toEqual({
    serversById: {},
    sessionsByServerId: {},
    preferencesByServerId: {},
    uiState: {}
  });
});

test("partial stored shape migration fills missing maps and ui state", async () => {
  setChromeStorageData({
    extensionStorage: {
      serversById: {
        [server.id]: server
      }
    }
  });

  await expect(getExtensionStorage()).resolves.toEqual({
    serversById: {
      [server.id]: server
    },
    sessionsByServerId: {},
    preferencesByServerId: {},
    uiState: {}
  });
});

test("complete stored shape read does not write back to chrome storage", async () => {
  setChromeStorageData({
    extensionStorage: {
      serversById: {},
      sessionsByServerId: {},
      preferencesByServerId: {},
      uiState: {}
    }
  });

  await getExtensionStorage();

  expect(chrome.storage.local.set).not.toHaveBeenCalled();
});
