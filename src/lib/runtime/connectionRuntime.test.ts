import { getChromeStorageData } from "../../test/chromeMock";
import { OpenWebUIError, type OpenWebUIModel, type OpenWebUIUser } from "../openwebui/types";
import { connectToServer, type OpenWebUIConnectionClient } from "./connectionRuntime";

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
