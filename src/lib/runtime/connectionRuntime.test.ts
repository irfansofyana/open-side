import { getChromeStorageData, setChromeStorageData } from "../../test/chromeMock";
import {
  defaultFeatureFlags,
  OpenWebUIError,
  type OpenWebUIModel,
  type OpenWebUIUser
} from "../openwebui/types";
import {
  connectToServer,
  restoreSavedConnection,
  type OpenWebUIConnectionClient
} from "./connectionRuntime";

const now = () => new Date("2026-05-01T02:03:04.000Z");

type ClientFactoryOptions = {
  baseUrl: string;
  getToken: () => string | undefined | Promise<string | undefined>;
};

const createClientFactory = () => {
  const user: OpenWebUIUser = {
    id: "user-1",
    name: "Ada",
    email: "ada@example.com",
    role: "admin"
  };
  const models: OpenWebUIModel[] = [
    { id: "llama3.1", name: "Llama 3.1" },
    { id: "mistral", name: "Mistral" }
  ];
  const probeConfig = vi.fn<OpenWebUIConnectionClient["probeConfig"]>().mockResolvedValue({
    webui_name: "Open WebUI"
  });
  const signIn = vi.fn<OpenWebUIConnectionClient["signIn"]>().mockResolvedValue({
    token: "token-1",
    tokenType: "Bearer"
  });
  const getCurrentUser = vi.fn<OpenWebUIConnectionClient["getCurrentUser"]>().mockResolvedValue(user);
  const getModels = vi.fn<OpenWebUIConnectionClient["getModels"]>().mockResolvedValue(models);
  const clientFactory = vi.fn(({ getToken }: ClientFactoryOptions) => ({
    probeConfig,
    signIn,
    getCurrentUser: vi.fn(async () => {
      await getToken();
      return getCurrentUser();
    }),
    getModels: vi.fn(async () => {
      await getToken();
      return getModels();
    })
  }));

  return {
    clientFactory,
    getCurrentUser,
    getModels,
    models,
    probeConfig,
    signIn,
    user
  };
};

test("connectToServer requests permission, probes, signs in, fetches user/models, stores session, returns server/session/models", async () => {
  const requestPermission = vi.fn().mockResolvedValue({
    granted: true,
    originPattern: "https://openwebui.example.com/*"
  });
  const { clientFactory, models, probeConfig, signIn, user } = createClientFactory();

  const result = await connectToServer({
    serverUrl: " https://openwebui.example.com/ ",
    email: "ada@example.com",
    password: "secret",
    now,
    requestPermission,
    clientFactory
  });

  expect(requestPermission).toHaveBeenCalledWith("https://openwebui.example.com");
  expect(clientFactory).toHaveBeenCalledWith({
    baseUrl: "https://openwebui.example.com",
    getToken: expect.any(Function)
  });
  expect(probeConfig).toHaveBeenCalledOnce();
  expect(signIn).toHaveBeenCalledWith({ email: "ada@example.com", password: "secret" });
  expect(result).toEqual({
    server: {
      id: "server-openwebui-example-com",
      baseUrl: "https://openwebui.example.com",
      displayName: "openwebui.example.com",
      createdAt: "2026-05-01T02:03:04.000Z",
      lastConnectedAt: "2026-05-01T02:03:04.000Z"
    },
    session: {
      serverId: "server-openwebui-example-com",
      token: "token-1",
      tokenType: "Bearer",
      user
    },
    models
  });
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(getChromeStorageData()).toMatchObject({
    extensionStorage: {
      serversById: {
        "server-openwebui-example-com": result.server
      },
      sessionsByServerId: {
        "server-openwebui-example-com": result.session
      },
      uiState: {
        activeServerId: "server-openwebui-example-com"
      }
    }
  });
  expect(JSON.stringify(getChromeStorageData())).not.toContain("secret");
});

test("permission denied throws OpenWebUIError and does not instantiate client", async () => {
  const requestPermission = vi.fn().mockResolvedValue({
    granted: false,
    originPattern: "https://openwebui.example.com/*"
  });
  const { clientFactory } = createClientFactory();

  await expect(
    connectToServer({
      serverUrl: "https://openwebui.example.com",
      email: "ada@example.com",
      password: "secret",
      now,
      requestPermission,
      clientFactory
    })
  ).rejects.toMatchObject({
    code: "ServerUnreachableError",
    message: "Permission was not granted for the server origin"
  } satisfies Partial<OpenWebUIError>);

  expect(clientFactory).not.toHaveBeenCalled();
  expect(getChromeStorageData()).toEqual({});
});

test("sign-in token is used for getCurrentUser and getModels via token provider after signIn", async () => {
  const observedTokens: Array<string | undefined> = [];
  const requestPermission = vi.fn().mockResolvedValue({
    granted: true,
    originPattern: "https://openwebui.example.com/*"
  });
  const clientFactory = vi.fn(({ getToken }: ClientFactoryOptions) => ({
    probeConfig: vi.fn().mockResolvedValue({ webui_name: "Open WebUI" }),
    signIn: vi.fn(async () => {
      observedTokens.push(await getToken());
      return { token: "token-after-signin", tokenType: "Bearer" as const };
    }),
    getCurrentUser: vi.fn(async () => {
      observedTokens.push(await getToken());
      return { id: "user-1" };
    }),
    getModels: vi.fn(async () => {
      observedTokens.push(await getToken());
      return [];
    })
  }));

  await connectToServer({
    serverUrl: "https://openwebui.example.com",
    email: "ada@example.com",
    password: "secret",
    now,
    requestPermission,
    clientFactory
  });

  expect(observedTokens).toEqual([undefined, "token-after-signin", "token-after-signin"]);
});

test("server id sanitizes host and port predictably", async () => {
  const requestPermission = vi.fn().mockResolvedValue({
    granted: true,
    originPattern: "http://localhost:3000/*"
  });
  const { clientFactory } = createClientFactory();

  const result = await connectToServer({
    serverUrl: "http://localhost:3000/api/",
    email: "ada@example.com",
    password: "secret",
    now,
    requestPermission,
    clientFactory
  });

  expect(result.server).toMatchObject({
    id: "server-localhost-3000",
    displayName: "localhost:3000"
  });
});

test("restoreSavedConnection reuses active stored token and returns models", async () => {
  const server = {
    id: "server-openwebui-example-com",
    baseUrl: "https://openwebui.example.com",
    displayName: "openwebui.example.com",
    createdAt: "2026-05-01T01:00:00.000Z",
    lastConnectedAt: "2026-05-01T01:00:00.000Z"
  };
  const session = {
    serverId: server.id,
    token: "stored-token",
    tokenType: "Bearer" as const,
    user: { id: "old-user", email: "ada@example.com" }
  };
  const models = [{ id: "llama3.1" }, { id: "mistral", name: "Mistral" }];
  const observedTokens: string[] = [];
  const clientFactory = vi.fn(({ getToken }: ClientFactoryOptions) => ({
    probeConfig: vi.fn(),
    signIn: vi.fn(),
    getCurrentUser: vi.fn(async () => {
      observedTokens.push((await getToken()) ?? "");
      return { id: "user-1", email: "ada@example.com", name: "Ada" };
    }),
    getModels: vi.fn(async () => {
      observedTokens.push((await getToken()) ?? "");
      return models;
    })
  }));
  setChromeStorageData({
    extensionStorage: {
      serversById: { [server.id]: server },
      sessionsByServerId: { [server.id]: session },
      preferencesByServerId: {
        [server.id]: {
          serverId: server.id,
          selectedModelId: "mistral",
          enabledToolIds: [],
          enabledFeatures: defaultFeatureFlags
        }
      },
      uiState: { activeServerId: server.id }
    }
  });

  await expect(
    restoreSavedConnection({
      clientFactory,
      now
    })
  ).resolves.toEqual({
    status: "ready",
    connection: {
      server: {
        ...server,
        lastConnectedAt: "2026-05-01T02:03:04.000Z"
      },
      session: {
        ...session,
        user: { id: "user-1", email: "ada@example.com", name: "Ada" }
      },
      models
    },
    selectedModelId: "mistral"
  });
  expect(clientFactory).toHaveBeenCalledWith({
    baseUrl: "https://openwebui.example.com",
    getToken: expect.any(Function)
  });
  expect(observedTokens).toEqual(["stored-token", "stored-token"]);
});

test("restoreSavedConnection keeps server and email when token is expired", async () => {
  const server = {
    id: "server-openwebui-example-com",
    baseUrl: "https://openwebui.example.com",
    displayName: "openwebui.example.com",
    createdAt: "2026-05-01T01:00:00.000Z",
    lastConnectedAt: "2026-05-01T01:00:00.000Z"
  };
  setChromeStorageData({
    extensionStorage: {
      serversById: { [server.id]: server },
      sessionsByServerId: {
        [server.id]: {
          serverId: server.id,
          token: "expired-token",
          tokenType: "Bearer",
          expiresAt: "2026-04-30T01:00:00.000Z",
          user: { email: "ada@example.com" }
        }
      },
      preferencesByServerId: {},
      uiState: { activeServerId: server.id }
    }
  });

  await expect(restoreSavedConnection({ now })).resolves.toEqual({
    status: "loginRequired",
    server,
    email: "ada@example.com",
    message: "Open WebUI session expired. Please log in again."
  });
});

test("restoreSavedConnection keeps saved server when token validation cannot reach server", async () => {
  const server = {
    id: "server-openwebui-example-com",
    baseUrl: "https://openwebui.example.com",
    displayName: "openwebui.example.com",
    createdAt: "2026-05-01T01:00:00.000Z",
    lastConnectedAt: "2026-05-01T01:00:00.000Z"
  };
  const clientFactory = vi.fn(() => ({
    probeConfig: vi.fn(),
    signIn: vi.fn(),
    getCurrentUser: vi.fn(async () => {
      throw new OpenWebUIError("ServerUnreachableError", "Unable to reach Open WebUI server");
    }),
    getModels: vi.fn()
  }));
  setChromeStorageData({
    extensionStorage: {
      serversById: { [server.id]: server },
      sessionsByServerId: {
        [server.id]: {
          serverId: server.id,
          token: "stored-token",
          tokenType: "Bearer",
          user: { email: "ada@example.com" }
        }
      },
      preferencesByServerId: {},
      uiState: { activeServerId: server.id }
    }
  });

  await expect(restoreSavedConnection({ clientFactory, now })).resolves.toEqual({
    status: "loginRequired",
    server,
    email: "ada@example.com",
    message: "Unable to reach Open WebUI server"
  });
});
