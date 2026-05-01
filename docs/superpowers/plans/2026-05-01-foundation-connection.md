# Foundation And Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chrome Manifest V3 extension shell, persistent storage layer, server permission flow, local Open WebUI login, current-user fetch, and model loading.

**Architecture:** The side panel owns UI state and calls focused services under `src/lib`. A thin service worker only opens the side panel. Open WebUI server details are isolated behind an API client so later chat, tools, and history work can reuse the same token and error handling path.

**Tech Stack:** Vite, React, TypeScript, Chrome Manifest V3, Vitest, Testing Library, `chrome.storage.local`, `chrome.permissions`.

---

## Source Documents

- [PRD](../../PRD.md)
- [Technical Design](../../TECHNICAL_DESIGN.md)

## File Structure

- Create: `package.json` - scripts and dependencies for the extension project.
- Create: `tsconfig.json` - strict TypeScript config shared by app and tests.
- Create: `vite.config.ts` - Vite React build plus Vitest config.
- Create: `index.html` - Vite development entry.
- Create: `public/manifest.json` - Chrome MV3 manifest with side panel permissions.
- Create: `src/background/serviceWorker.ts` - opens the side panel on extension action click.
- Create: `src/sidepanel/index.html` - side panel HTML entry generated into the extension build.
- Create: `src/sidepanel/main.tsx` - React side panel bootstrap.
- Create: `src/sidepanel/App.tsx` - connection, auth loading, and model-ready states.
- Create: `src/sidepanel/styles.css` - narrow-first dark side panel styling.
- Create: `src/lib/chrome/storage.ts` - typed storage wrapper and migrations.
- Create: `src/lib/chrome/permissions.ts` - optional host permission request for the configured server origin.
- Create: `src/lib/openwebui/types.ts` - shared server, session, model, user, and error types.
- Create: `src/lib/openwebui/client.ts` - base URL normalization, auth headers, config probe, sign-in, current user, and model calls.
- Create: `src/lib/runtime/connectionRuntime.ts` - orchestrates server probe, permission request, sign-in, storage, and model loading.
- Create: `src/test/chromeMock.ts` - Chrome API mock used by unit tests.
- Create: `src/lib/chrome/storage.test.ts` - storage wrapper tests.
- Create: `src/lib/chrome/permissions.test.ts` - server-origin permission tests.
- Create: `src/lib/openwebui/client.test.ts` - API client tests with mocked `fetch`.
- Create: `src/lib/runtime/connectionRuntime.test.ts` - login orchestration tests.

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/sidepanel/index.html`

- [ ] **Step 1: Create package scripts and dependencies**

Create `package.json`:

```json
{
  "name": "open-webui-chrome-extension",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@vitejs/plugin-react": "^5.0.0",
    "vite": "^7.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "lucide-react": "^0.468.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.1.0",
    "@types/chrome": "^0.0.287",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: Create TypeScript config**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": ["chrome", "vitest/globals"]
  },
  "include": ["src", "vite.config.ts"]
}
```

- [ ] **Step 3: Create Vite and Vitest config**

Create `vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: "src/sidepanel/index.html",
        serviceWorker: "src/background/serviceWorker.ts"
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === "serviceWorker" ? "background/serviceWorker.js" : "assets/[name].js"
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/chromeMock.ts"],
    globals: true
  }
});
```

- [ ] **Step 4: Create HTML entries**

Create `index.html` for Vite development:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open WebUI Side Panel</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/sidepanel/main.tsx"></script>
  </body>
</html>
```

Create `src/sidepanel/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Open WebUI</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and npm exits with code 0.

- [ ] **Step 6: Verify scaffold**

Run: `npm run lint`

Expected: TypeScript reports no errors after the source files in later tasks are created.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/sidepanel/index.html
git commit -m "chore: scaffold extension project"
```

## Task 2: Manifest And Service Worker

**Files:**
- Create: `public/manifest.json`
- Create: `src/background/serviceWorker.ts`

- [ ] **Step 1: Create MV3 manifest**

Create `public/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Open WebUI Side Panel",
  "description": "Chat with your Open WebUI server from Chrome's side panel.",
  "version": "0.1.0",
  "permissions": ["sidePanel", "storage", "activeTab", "scripting", "tabs"],
  "optional_host_permissions": ["http://*/*", "https://*/*"],
  "background": {
    "service_worker": "background/serviceWorker.js",
    "type": "module"
  },
  "side_panel": {
    "default_path": "sidepanel/index.html"
  },
  "action": {
    "default_title": "Open WebUI"
  }
}
```

- [ ] **Step 2: Create thin service worker**

Create `src/background/serviceWorker.ts`:

```ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId === undefined) {
    return;
  }

  await chrome.sidePanel.open({ windowId: tab.windowId });
});
```

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: `dist/manifest.json`, `dist/background/serviceWorker.js`, and side panel assets are produced.

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json src/background/serviceWorker.ts
git commit -m "feat: add manifest v3 side panel shell"
```

## Task 3: Typed Storage

**Files:**
- Create: `src/lib/openwebui/types.ts`
- Create: `src/lib/chrome/storage.ts`
- Create: `src/test/chromeMock.ts`
- Create: `src/lib/chrome/storage.test.ts`

- [ ] **Step 1: Define shared types**

Create `src/lib/openwebui/types.ts`:

```ts
export type ServerRecord = {
  id: string;
  baseUrl: string;
  displayName: string;
  createdAt: string;
  lastConnectedAt: string;
};

export type OpenWebUIUser = {
  id?: string;
  name?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
};

export type SessionRecord = {
  serverId: string;
  token: string;
  tokenType: "Bearer";
  expiresAt?: string;
  user: OpenWebUIUser;
};

export type FeatureFlags = {
  web_search: boolean;
  image_generation: boolean;
  code_interpreter: boolean;
  memory: boolean;
};

export type ServerPreferences = {
  serverId: string;
  selectedModelId?: string;
  enabledToolIds: string[];
  enabledFeatures: FeatureFlags;
};

export type ExtensionStorage = {
  serversById: Record<string, ServerRecord>;
  sessionsByServerId: Record<string, SessionRecord>;
  preferencesByServerId: Record<string, ServerPreferences>;
  uiState: {
    activeServerId?: string;
    activeChatId?: string;
  };
};

export type OpenWebUIModel = {
  id: string;
  name?: string;
  object?: string;
  owned_by?: string;
  [key: string]: unknown;
};

export type OpenWebUIModelDetail = OpenWebUIModel & {
  params?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

export const defaultFeatureFlags: FeatureFlags = {
  web_search: false,
  image_generation: false,
  code_interpreter: false,
  memory: false
};
```

- [ ] **Step 2: Mock Chrome storage in tests**

Create `src/test/chromeMock.ts`:

```ts
import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";

type StorageArea = Record<string, unknown>;

let storage: StorageArea = {};

beforeEach(() => {
  storage = {};

  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
          if (!keys) {
            return { ...storage };
          }
          if (typeof keys === "string") {
            return { [keys]: storage[keys] };
          }
          if (Array.isArray(keys)) {
            return Object.fromEntries(keys.map((key) => [key, storage[key]]));
          }
          return Object.fromEntries(
            Object.entries(keys).map(([key, fallback]) => [key, storage[key] ?? fallback])
          );
        }),
        set: vi.fn(async (items: StorageArea) => {
          storage = { ...storage, ...items };
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            delete storage[key];
          }
        }),
        clear: vi.fn(async () => {
          storage = {};
        })
      }
    },
    permissions: {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true)
    },
    runtime: {
      onInstalled: { addListener: vi.fn() }
    },
    action: {
      onClicked: { addListener: vi.fn() }
    },
    sidePanel: {
      setPanelBehavior: vi.fn(async () => undefined),
      open: vi.fn(async () => undefined)
    }
  } as unknown as typeof chrome;
});
```

- [ ] **Step 3: Write storage tests**

Create `src/lib/chrome/storage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defaultFeatureFlags } from "../openwebui/types";
import { clearServerSession, getExtensionStorage, saveServerConnection } from "./storage";

describe("storage", () => {
  it("returns a complete empty storage shape", async () => {
    await expect(getExtensionStorage()).resolves.toEqual({
      serversById: {},
      sessionsByServerId: {},
      preferencesByServerId: {},
      uiState: {}
    });
  });

  it("saves server, session, default preferences, and active server", async () => {
    await saveServerConnection({
      server: {
        id: "server-localhost-3000",
        baseUrl: "http://localhost:3000",
        displayName: "localhost:3000",
        createdAt: "2026-05-01T00:00:00.000Z",
        lastConnectedAt: "2026-05-01T00:00:00.000Z"
      },
      session: {
        serverId: "server-localhost-3000",
        token: "secret-token",
        tokenType: "Bearer",
        user: { email: "user@example.com" }
      }
    });

    const stored = await getExtensionStorage();

    expect(stored.uiState.activeServerId).toBe("server-localhost-3000");
    expect(stored.serversById["server-localhost-3000"].baseUrl).toBe("http://localhost:3000");
    expect(stored.sessionsByServerId["server-localhost-3000"].token).toBe("secret-token");
    expect(stored.preferencesByServerId["server-localhost-3000"].enabledFeatures).toEqual(
      defaultFeatureFlags
    );
  });

  it("clears session and cached preferences on logout without deleting server record", async () => {
    await saveServerConnection({
      server: {
        id: "server-localhost-3000",
        baseUrl: "http://localhost:3000",
        displayName: "localhost:3000",
        createdAt: "2026-05-01T00:00:00.000Z",
        lastConnectedAt: "2026-05-01T00:00:00.000Z"
      },
      session: {
        serverId: "server-localhost-3000",
        token: "secret-token",
        tokenType: "Bearer",
        user: { email: "user@example.com" }
      }
    });

    await clearServerSession("server-localhost-3000");
    const stored = await getExtensionStorage();

    expect(stored.serversById["server-localhost-3000"]).toBeDefined();
    expect(stored.sessionsByServerId["server-localhost-3000"]).toBeUndefined();
    expect(stored.preferencesByServerId["server-localhost-3000"]).toBeUndefined();
    expect(stored.uiState.activeServerId).toBeUndefined();
  });
});
```

- [ ] **Step 4: Run failing test**

Run: `npm test -- src/lib/chrome/storage.test.ts`

Expected: FAIL because `src/lib/chrome/storage.ts` does not exist.

- [ ] **Step 5: Implement storage wrapper**

Create `src/lib/chrome/storage.ts`:

```ts
import {
  defaultFeatureFlags,
  ExtensionStorage,
  ServerRecord,
  SessionRecord
} from "../openwebui/types";

const STORAGE_KEY = "openWebUIExtensionStorage";

const emptyStorage = (): ExtensionStorage => ({
  serversById: {},
  sessionsByServerId: {},
  preferencesByServerId: {},
  uiState: {}
});

export async function getExtensionStorage(): Promise<ExtensionStorage> {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: emptyStorage() });
  const stored = result[STORAGE_KEY] as Partial<ExtensionStorage> | undefined;

  return {
    ...emptyStorage(),
    ...stored,
    serversById: stored?.serversById ?? {},
    sessionsByServerId: stored?.sessionsByServerId ?? {},
    preferencesByServerId: stored?.preferencesByServerId ?? {},
    uiState: stored?.uiState ?? {}
  };
}

async function setExtensionStorage(storage: ExtensionStorage): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: storage });
}

export async function saveServerConnection(input: {
  server: ServerRecord;
  session: SessionRecord;
}): Promise<ExtensionStorage> {
  const storage = await getExtensionStorage();

  const next: ExtensionStorage = {
    ...storage,
    serversById: {
      ...storage.serversById,
      [input.server.id]: input.server
    },
    sessionsByServerId: {
      ...storage.sessionsByServerId,
      [input.server.id]: input.session
    },
    preferencesByServerId: {
      ...storage.preferencesByServerId,
      [input.server.id]: storage.preferencesByServerId[input.server.id] ?? {
        serverId: input.server.id,
        enabledToolIds: [],
        enabledFeatures: defaultFeatureFlags
      }
    },
    uiState: {
      ...storage.uiState,
      activeServerId: input.server.id
    }
  };

  await setExtensionStorage(next);
  return next;
}

export async function clearServerSession(serverId: string): Promise<ExtensionStorage> {
  const storage = await getExtensionStorage();
  const { [serverId]: _session, ...sessionsByServerId } = storage.sessionsByServerId;
  const { [serverId]: _preferences, ...preferencesByServerId } = storage.preferencesByServerId;

  const next: ExtensionStorage = {
    ...storage,
    sessionsByServerId,
    preferencesByServerId,
    uiState: {
      ...storage.uiState,
      activeServerId: storage.uiState.activeServerId === serverId ? undefined : storage.uiState.activeServerId,
      activeChatId: storage.uiState.activeServerId === serverId ? undefined : storage.uiState.activeChatId
    }
  };

  await setExtensionStorage(next);
  return next;
}
```

- [ ] **Step 6: Run storage tests**

Run: `npm test -- src/lib/chrome/storage.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/openwebui/types.ts src/lib/chrome/storage.ts src/test/chromeMock.ts src/lib/chrome/storage.test.ts
git commit -m "feat: add typed extension storage"
```

## Task 4: Server Origin Permissions

**Files:**
- Create: `src/lib/chrome/permissions.ts`
- Create: `src/lib/chrome/permissions.test.ts`

- [ ] **Step 1: Write permission tests**

Create `src/lib/chrome/permissions.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { requestServerOriginPermission, toOriginPattern } from "./permissions";

describe("permissions", () => {
  it("normalizes http and https server URLs to origin patterns", () => {
    expect(toOriginPattern("http://localhost:3000/api")).toBe("http://localhost:3000/*");
    expect(toOriginPattern("https://openwebui.example.com/path")).toBe(
      "https://openwebui.example.com/*"
    );
  });

  it("rejects invalid server URLs", () => {
    expect(() => toOriginPattern("not a url")).toThrow("Invalid server URL");
  });

  it("does not request permission when the origin is already granted", async () => {
    vi.mocked(chrome.permissions.contains).mockResolvedValueOnce(true);

    await expect(requestServerOriginPermission("http://localhost:3000")).resolves.toEqual({
      granted: true,
      originPattern: "http://localhost:3000/*"
    });

    expect(chrome.permissions.request).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run failing test**

Run: `npm test -- src/lib/chrome/permissions.test.ts`

Expected: FAIL because `permissions.ts` does not exist.

- [ ] **Step 3: Implement permission helpers**

Create `src/lib/chrome/permissions.ts`:

```ts
export type ServerPermissionResult = {
  granted: boolean;
  originPattern: string;
};

export function toOriginPattern(serverUrl: string): string {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    throw new Error("Invalid server URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server URL must use http or https");
  }

  return `${url.origin}/*`;
}

export async function requestServerOriginPermission(serverUrl: string): Promise<ServerPermissionResult> {
  const originPattern = toOriginPattern(serverUrl);
  const permissions = { origins: [originPattern] };
  const alreadyGranted = await chrome.permissions.contains(permissions);

  if (alreadyGranted) {
    return { granted: true, originPattern };
  }

  const granted = await chrome.permissions.request(permissions);
  return { granted, originPattern };
}
```

- [ ] **Step 4: Run permission tests**

Run: `npm test -- src/lib/chrome/permissions.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chrome/permissions.ts src/lib/chrome/permissions.test.ts
git commit -m "feat: request configured server origin permission"
```

## Task 5: Open WebUI Auth And Models Client

**Files:**
- Modify: `src/lib/openwebui/types.ts`
- Create: `src/lib/openwebui/client.ts`
- Create: `src/lib/openwebui/client.test.ts`

- [ ] **Step 1: Extend API error types**

Append this to `src/lib/openwebui/types.ts`:

```ts
export type OpenWebUIErrorCode =
  | "ServerUnreachableError"
  | "NotOpenWebUIError"
  | "AuthFailedError"
  | "TokenExpiredError"
  | "ModelUnavailableError";

export class OpenWebUIError extends Error {
  constructor(
    public readonly code: OpenWebUIErrorCode,
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "OpenWebUIError";
  }
}
```

- [ ] **Step 2: Write client tests**

Create `src/lib/openwebui/client.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenWebUIClient, normalizeBaseUrl } from "./client";
import { OpenWebUIError } from "./types";

describe("OpenWebUIClient", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it("normalizes base URLs", () => {
    expect(normalizeBaseUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(normalizeBaseUrl("https://example.com/webui")).toBe("https://example.com/webui");
  });

  it("probes /api/config and rejects non Open WebUI shapes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const client = new OpenWebUIClient({
      baseUrl: "http://localhost:3000",
      getToken: async () => undefined
    });

    await expect(client.probeConfig()).rejects.toMatchObject({
      code: "NotOpenWebUIError"
    });
  });

  it("signs in and fetches current user with bearer token", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "token-1", token_type: "Bearer" }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ email: "user@example.com", role: "user" }), { status: 200 })
      );

    const client = new OpenWebUIClient({
      baseUrl: "http://localhost:3000",
      getToken: async () => "token-1"
    });

    await expect(client.signIn({ email: "user@example.com", password: "secret" })).resolves.toEqual({
      token: "token-1",
      tokenType: "Bearer"
    });
    await expect(client.getCurrentUser()).resolves.toMatchObject({ email: "user@example.com" });

    expect(fetch).toHaveBeenLastCalledWith(
      "http://localhost:3000/api/v1/auths/",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token-1" })
      })
    );
  });

  it("loads model list and selected model detail", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "llama" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "llama", meta: { toolIds: [] } }), { status: 200 }));

    const client = new OpenWebUIClient({
      baseUrl: "http://localhost:3000",
      getToken: async () => "token-1"
    });

    await expect(client.getModels()).resolves.toEqual([{ id: "llama" }]);
    await expect(client.getModelDetail("llama")).resolves.toMatchObject({ id: "llama" });
  });

  it("maps unauthorized responses to TokenExpiredError", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));

    const client = new OpenWebUIClient({
      baseUrl: "http://localhost:3000",
      getToken: async () => "expired"
    });

    await expect(client.getCurrentUser()).rejects.toMatchObject({
      name: "OpenWebUIError",
      code: "TokenExpiredError"
    });
  });
});
```

- [ ] **Step 3: Run failing client tests**

Run: `npm test -- src/lib/openwebui/client.test.ts`

Expected: FAIL because `client.ts` does not exist.

- [ ] **Step 4: Implement API client**

Create `src/lib/openwebui/client.ts`:

```ts
import {
  OpenWebUIError,
  OpenWebUIModel,
  OpenWebUIModelDetail,
  OpenWebUIUser
} from "./types";

type ClientOptions = {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
};

type SignInInput = {
  email: string;
  password: string;
};

type SignInResult = {
  token: string;
  tokenType: "Bearer";
};

export function normalizeBaseUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new OpenWebUIError("ServerUnreachableError", "Invalid server URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new OpenWebUIError("ServerUnreachableError", "Server URL must use http or https");
  }

  return url.toString().replace(/\/$/, "");
}

export class OpenWebUIClient {
  private readonly baseUrl: string;
  private readonly getToken: () => Promise<string | undefined>;

  constructor(options: ClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.getToken = options.getToken;
  }

  async probeConfig(): Promise<Record<string, unknown>> {
    const config = await this.request<Record<string, unknown>>("/api/config");
    const keys = Object.keys(config);

    if (!keys.some((key) => key.toLowerCase().includes("webui") || key.toLowerCase().includes("oauth"))) {
      throw new OpenWebUIError("NotOpenWebUIError", "Server does not look like Open WebUI");
    }

    return config;
  }

  async signIn(input: SignInInput): Promise<SignInResult> {
    const response = await this.request<{ token?: string; token_type?: string }>("/api/v1/auths/signin", {
      method: "POST",
      body: JSON.stringify({ email: input.email, password: input.password }),
      skipAuth: true
    });

    if (!response.token) {
      throw new OpenWebUIError("AuthFailedError", "Open WebUI did not return a token");
    }

    return {
      token: response.token,
      tokenType: "Bearer"
    };
  }

  async getCurrentUser(): Promise<OpenWebUIUser> {
    return this.request<OpenWebUIUser>("/api/v1/auths/");
  }

  async getModels(): Promise<OpenWebUIModel[]> {
    const response = await this.request<{ data?: OpenWebUIModel[] } | OpenWebUIModel[]>("/api/models");
    return Array.isArray(response) ? response : response.data ?? [];
  }

  async getModelDetail(modelId: string): Promise<OpenWebUIModelDetail> {
    const encodedId = encodeURIComponent(modelId);
    return this.request<OpenWebUIModelDetail>(`/api/v1/models/model?id=${encodedId}`);
  }

  private async request<T>(
    path: string,
    options: RequestInit & { skipAuth?: boolean } = {}
  ): Promise<T> {
    const headers = new Headers(options.headers);
    headers.set("Content-Type", "application/json");

    if (!options.skipAuth) {
      const token = await this.getToken();
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers
      });
    } catch {
      throw new OpenWebUIError("ServerUnreachableError", "Unable to reach Open WebUI server");
    }

    if (response.status === 401 || response.status === 403) {
      throw new OpenWebUIError("TokenExpiredError", "Open WebUI session expired", response.status);
    }

    if (!response.ok) {
      const code = path.includes("signin") ? "AuthFailedError" : "ServerUnreachableError";
      throw new OpenWebUIError(code, `Open WebUI request failed with ${response.status}`, response.status);
    }

    return response.json() as Promise<T>;
  }
}
```

- [ ] **Step 5: Run client tests**

Run: `npm test -- src/lib/openwebui/client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/openwebui/types.ts src/lib/openwebui/client.ts src/lib/openwebui/client.test.ts
git commit -m "feat: add open webui auth client"
```

## Task 6: Connection Runtime And UI

**Files:**
- Create: `src/lib/runtime/connectionRuntime.ts`
- Create: `src/lib/runtime/connectionRuntime.test.ts`
- Create: `src/sidepanel/main.tsx`
- Create: `src/sidepanel/App.tsx`
- Create: `src/sidepanel/styles.css`

- [ ] **Step 1: Write connection runtime test**

Create `src/lib/runtime/connectionRuntime.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { connectToServer } from "./connectionRuntime";

describe("connectionRuntime", () => {
  it("requests permission, probes config, signs in, fetches user, fetches models, and stores session", async () => {
    const clientFactory = vi.fn(() => ({
      probeConfig: vi.fn(async () => ({ webui_name: "Open WebUI" })),
      signIn: vi.fn(async () => ({ token: "token-1", tokenType: "Bearer" as const })),
      getCurrentUser: vi.fn(async () => ({ email: "user@example.com" })),
      getModels: vi.fn(async () => [{ id: "llama" }])
    }));

    const result = await connectToServer({
      serverUrl: "http://localhost:3000",
      email: "user@example.com",
      password: "secret",
      now: () => "2026-05-01T00:00:00.000Z",
      requestPermission: async () => ({ granted: true, originPattern: "http://localhost:3000/*" }),
      clientFactory
    });

    expect(result.server.id).toBe("server-localhost-3000");
    expect(result.models).toEqual([{ id: "llama" }]);
    expect(result.session.token).toBe("token-1");
  });
});
```

- [ ] **Step 2: Run failing runtime test**

Run: `npm test -- src/lib/runtime/connectionRuntime.test.ts`

Expected: FAIL because `connectionRuntime.ts` does not exist.

- [ ] **Step 3: Implement connection runtime**

Create `src/lib/runtime/connectionRuntime.ts`:

```ts
import { requestServerOriginPermission } from "../chrome/permissions";
import { saveServerConnection } from "../chrome/storage";
import { OpenWebUIClient, normalizeBaseUrl } from "../openwebui/client";
import { OpenWebUIError, OpenWebUIModel, ServerRecord, SessionRecord } from "../openwebui/types";

type ConnectInput = {
  serverUrl: string;
  email: string;
  password: string;
  now?: () => string;
  requestPermission?: typeof requestServerOriginPermission;
  clientFactory?: (baseUrl: string, getToken: () => Promise<string | undefined>) => Pick<
    OpenWebUIClient,
    "probeConfig" | "signIn" | "getCurrentUser" | "getModels"
  >;
};

type ConnectResult = {
  server: ServerRecord;
  session: SessionRecord;
  models: OpenWebUIModel[];
};

export async function connectToServer(input: ConnectInput): Promise<ConnectResult> {
  const baseUrl = normalizeBaseUrl(input.serverUrl);
  const permission = await (input.requestPermission ?? requestServerOriginPermission)(baseUrl);

  if (!permission.granted) {
    throw new OpenWebUIError("ServerUnreachableError", "Permission was not granted for the server origin");
  }

  let token: string | undefined;
  const client =
    input.clientFactory?.(baseUrl, async () => token) ??
    new OpenWebUIClient({ baseUrl, getToken: async () => token });

  await client.probeConfig();
  const signIn = await client.signIn({ email: input.email, password: input.password });
  token = signIn.token;

  const user = await client.getCurrentUser();
  const models = await client.getModels();
  const timestamp = input.now?.() ?? new Date().toISOString();
  const url = new URL(baseUrl);
  const serverId = `server-${url.host.replace(/[^a-zA-Z0-9]+/g, "-")}`;

  const server: ServerRecord = {
    id: serverId,
    baseUrl,
    displayName: url.host,
    createdAt: timestamp,
    lastConnectedAt: timestamp
  };

  const session: SessionRecord = {
    serverId,
    token,
    tokenType: "Bearer",
    user
  };

  await saveServerConnection({ server, session });

  return { server, session, models };
}
```

- [ ] **Step 4: Run runtime tests**

Run: `npm test -- src/lib/runtime/connectionRuntime.test.ts`

Expected: PASS.

- [ ] **Step 5: Create React bootstrap**

Create `src/sidepanel/main.tsx`:

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 6: Create connection UI**

Create `src/sidepanel/App.tsx`:

```tsx
import { FormEvent, useState } from "react";
import { LogIn } from "lucide-react";
import { connectToServer } from "../lib/runtime/connectionRuntime";
import { OpenWebUIModel } from "../lib/openwebui/types";

type ViewState =
  | { status: "unconfigured" }
  | { status: "authenticating" }
  | { status: "ready"; displayName: string; models: OpenWebUIModel[] }
  | { status: "error"; message: string };

export function App() {
  const [viewState, setViewState] = useState<ViewState>({ status: "unconfigured" });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const serverUrl = String(form.get("serverUrl") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    setViewState({ status: "authenticating" });

    try {
      const result = await connectToServer({ serverUrl, email, password });
      event.currentTarget.reset();
      setViewState({
        status: "ready",
        displayName: result.server.displayName,
        models: result.models
      });
    } catch (error) {
      setViewState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to connect"
      });
    }
  }

  if (viewState.status === "ready") {
    return (
      <main className="panel">
        <header className="topBar">
          <span>Open WebUI</span>
          <span className="muted">{viewState.displayName}</span>
        </header>
        <section className="welcome">
          <h1>Ready to chat</h1>
          <label className="field">
            <span>Model</span>
            <select>
              {viewState.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name ?? model.id}
                </option>
              ))}
            </select>
          </label>
        </section>
      </main>
    );
  }

  return (
    <main className="panel">
      <header className="topBar">
        <span>Open WebUI</span>
      </header>
      <form className="connectForm" onSubmit={handleSubmit}>
        <h1>Connect server</h1>
        <label className="field">
          <span>Server URL</span>
          <input name="serverUrl" placeholder="http://localhost:3000" required />
        </label>
        <label className="field">
          <span>Email or username</span>
          <input name="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {viewState.status === "error" ? <p className="error">{viewState.message}</p> : null}
        <button className="primaryButton" type="submit" disabled={viewState.status === "authenticating"}>
          <LogIn size={18} />
          {viewState.status === "authenticating" ? "Connecting" : "Connect"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 7: Create narrow-first styles**

Create `src/sidepanel/styles.css`:

```css
:root {
  color-scheme: dark;
  font-family:
    Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #101418;
  color: #edf2f7;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-width: 320px;
  background: #101418;
}

button,
input,
select {
  font: inherit;
}

.panel {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #101418;
}

.topBar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  border-bottom: 1px solid #27313b;
  font-size: 14px;
  font-weight: 650;
}

.muted {
  color: #9aa8b5;
  font-weight: 500;
}

.connectForm,
.welcome {
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  padding: 28px 16px;
  display: grid;
  gap: 16px;
}

h1 {
  margin: 0 0 6px;
  font-size: 24px;
  line-height: 1.2;
  letter-spacing: 0;
}

.field {
  display: grid;
  gap: 7px;
  color: #c5d1dc;
  font-size: 13px;
}

.field input,
.field select {
  width: 100%;
  min-height: 42px;
  border: 1px solid #34424f;
  border-radius: 8px;
  padding: 0 11px;
  background: #171d23;
  color: #edf2f7;
}

.primaryButton {
  min-height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 0;
  border-radius: 8px;
  background: #d6ecff;
  color: #101418;
  font-weight: 700;
  cursor: pointer;
}

.primaryButton:disabled {
  cursor: wait;
  opacity: 0.75;
}

.error {
  margin: 0;
  color: #ffb4ab;
  font-size: 13px;
}
```

- [ ] **Step 8: Build and test**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS and `dist` contains manifest, service worker, and side panel assets.

- [ ] **Step 9: Commit**

```bash
git add src/lib/runtime/connectionRuntime.ts src/lib/runtime/connectionRuntime.test.ts src/sidepanel/main.tsx src/sidepanel/App.tsx src/sidepanel/styles.css
git commit -m "feat: add connection runtime and side panel login"
```

## Self-Review

- PRD coverage: installable extension, side panel shell, one-server login, password not persisted, server permission, token storage, current user fetch, model fetch, and initial model selector are covered.
- Technical design coverage: manifest permissions, thin service worker, typed `chrome.storage.local`, optional host permission for configured origin, config probe, sign-in, current user, and `/api/models` path are covered.
- Deferred to the chat runtime plan: server-side chat creation, streaming, recent chats, full history, finalization, and model detail loading during chat send.
- Placeholder scan: no placeholder terms are used as implementation instructions.
- Type consistency: `ServerRecord`, `SessionRecord`, `ServerPreferences`, `OpenWebUIModel`, `OpenWebUIClient`, and `connectToServer` signatures align across tasks.
