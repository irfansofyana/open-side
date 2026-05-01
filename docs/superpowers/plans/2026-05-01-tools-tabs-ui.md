# Tools Tabs And Side Panel UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Open WebUI server-side tool discovery and selection, browser tab context capture and prompt injection, Gemini-like chat UI controls, markdown rendering, logout, and manual Chrome acceptance testing.

**Architecture:** Tool availability is server-owned and normalized in `toolsRuntime.ts`. Browser context is client-side prompt augmentation in `TabContextService`. The React side panel composes runtime state into menus, composer controls, selected-tab sharing chips, and chat rendering without executing server-defined tools locally.

**Tech Stack:** React, TypeScript, Chrome `tabs` and `scripting` APIs, Vitest, Testing Library, lucide-react, safe markdown rendering.

---

## Source Documents

- [PRD](../../PRD.md)
- [Technical Design](../../TECHNICAL_DESIGN.md)

## File Structure

- Modify: `src/lib/openwebui/types.ts` - tool, function, feature, tab context, and UI error types.
- Modify: `src/lib/openwebui/client.ts` - tool and function discovery endpoints.
- Create: `src/lib/runtime/toolsRuntime.ts` - normalizes tools, filters, built-ins, model defaults, and selected state.
- Create: `src/lib/runtime/toolsRuntime.test.ts` - tool/default merging tests.
- Create: `src/content/extractPageContext.ts` - injected page extraction function.
- Create: `src/lib/chrome/tabs.ts` - list current-window tabs and capture selected tab context.
- Create: `src/lib/chrome/tabs.test.ts` - tab listing, truncation, and restricted-page tests.
- Create: `src/lib/runtime/tabPrompt.ts` - visible prompt augmentation blocks.
- Create: `src/lib/runtime/tabPrompt.test.ts` - prompt injection tests.
- Create: `src/lib/ui/markdown.ts` - safe markdown rendering helpers.
- Create: `src/lib/ui/errors.ts` - UI error message mapping.
- Modify: `src/sidepanel/App.tsx` - top menu, history view, chat view, tools menu, tabs picker, composer, logout.
- Modify: `src/sidepanel/styles.css` - production side panel layout.
- Create: `src/sidepanel/App.test.tsx` - UI smoke tests for core journeys.
- Create: `docs/manual-test-checklist.md` - unpacked extension acceptance checklist.

## Task 1: Tool And Function Types

**Files:**
- Modify: `src/lib/openwebui/types.ts`

- [ ] **Step 1: Add tool and tab context types**

Append this to `src/lib/openwebui/types.ts`:

```ts
export type ToolMenuItem = {
  id: string;
  name: string;
  description?: string;
  kind: "tool" | "filter" | "builtin";
  isGlobal?: boolean;
  isActive?: boolean;
  isEnabledByDefault?: boolean;
};

export type ToolsSelection = {
  toolIds: string[];
  filterIds: string[];
  features: FeatureFlags;
};

export type BrowserTabSummary = {
  id: number;
  title: string;
  url: string;
  origin: string;
  favIconUrl?: string;
  isActive: boolean;
};

export type CapturedTabContext = BrowserTabSummary & {
  selectedText: string;
  readableText: string;
  readableTextUnavailable: boolean;
  truncated: boolean;
};
```

- [ ] **Step 2: Run type check**

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/openwebui/types.ts
git commit -m "feat: add tool and tab context types"
```

## Task 2: Tool Discovery Client And Runtime

**Files:**
- Modify: `src/lib/openwebui/client.ts`
- Modify: `src/lib/openwebui/client.test.ts`
- Create: `src/lib/runtime/toolsRuntime.ts`
- Create: `src/lib/runtime/toolsRuntime.test.ts`

- [ ] **Step 1: Add client tests for tools and functions**

Append to `src/lib/openwebui/client.test.ts`:

```ts
it("fetches tools and functions", async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "tool-1", name: "Search", description: "Search web" }]), {
        status: 200
      })
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ id: "filter-1", name: "Cite", type: "filter", is_active: true }]), {
        status: 200
      })
    );

  const client = new OpenWebUIClient({
    baseUrl: "http://localhost:3000",
    getToken: async () => "token-1"
  });

  await expect(client.getTools()).resolves.toEqual([
    { id: "tool-1", name: "Search", description: "Search web", raw: expect.any(Object) }
  ]);
  await expect(client.getFunctions()).resolves.toEqual([
    { id: "filter-1", name: "Cite", type: "filter", is_active: true }
  ]);
});
```

- [ ] **Step 2: Add client methods**

Add these methods inside `OpenWebUIClient`:

```ts
async getTools(): Promise<Array<{ id: string; name: string; description?: string; raw: Record<string, unknown> }>> {
  const response = await this.request<Array<Record<string, unknown>>>("/api/v1/tools/list");
  return response.map((tool) => ({
    id: String(tool.id),
    name: String(tool.name ?? tool.id),
    description: typeof tool.description === "string" ? tool.description : undefined,
    raw: tool
  }));
}

async getFunctions(): Promise<Array<Record<string, unknown>>> {
  return this.request<Array<Record<string, unknown>>>("/api/v1/functions/");
}
```

- [ ] **Step 3: Write tools runtime tests**

Create `src/lib/runtime/toolsRuntime.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildToolsMenu, resolveToolsSelection } from "./toolsRuntime";

describe("toolsRuntime", () => {
  it("normalizes server tools, toggle filters, and built-in features", () => {
    const menu = buildToolsMenu({
      tools: [{ id: "tool-1", name: "Search", description: "Search web", raw: { is_global: true } }],
      functions: [
        { id: "filter-1", name: "Cite", type: "filter", is_active: true, meta: { toggle: true } },
        { id: "hidden", name: "Hidden", type: "filter", is_active: false, meta: { toggle: true } }
      ],
      modelDetail: {
        id: "llama",
        meta: {
          toolIds: ["tool-1"],
          defaultFeatureIds: ["web_search"],
          capabilities: { web_search: true, code_interpreter: false }
        }
      }
    });

    expect(menu.map((item) => [item.id, item.kind, item.isEnabledByDefault])).toEqual([
      ["web_search", "builtin", true],
      ["tool-1", "tool", true],
      ["filter-1", "filter", true]
    ]);
  });

  it("resolves selected tool ids, filter ids, and feature flags", () => {
    const selection = resolveToolsSelection({
      menuItems: [
        { id: "web_search", name: "Web search", kind: "builtin", isEnabledByDefault: true },
        { id: "tool-1", name: "Search", kind: "tool", isEnabledByDefault: true },
        { id: "filter-1", name: "Cite", kind: "filter", isEnabledByDefault: true }
      ],
      disabledIds: ["tool-1"],
      enabledIds: ["code_interpreter"]
    });

    expect(selection.toolIds).toEqual([]);
    expect(selection.filterIds).toEqual(["filter-1"]);
    expect(selection.features).toMatchObject({
      web_search: true,
      code_interpreter: true,
      image_generation: false,
      memory: false
    });
  });
});
```

- [ ] **Step 4: Implement tools runtime**

Create `src/lib/runtime/toolsRuntime.ts`:

```ts
import {
  defaultFeatureFlags,
  OpenWebUIModelDetail,
  ToolMenuItem,
  ToolsSelection
} from "../openwebui/types";

type BuildToolsMenuInput = {
  tools: Array<{ id: string; name: string; description?: string; raw: Record<string, unknown> }>;
  functions: Array<Record<string, unknown>>;
  modelDetail: OpenWebUIModelDetail;
};

const builtinNames: Record<string, string> = {
  web_search: "Web search",
  image_generation: "Image generation",
  code_interpreter: "Code interpreter",
  memory: "Memory"
};

export function buildToolsMenu(input: BuildToolsMenuInput): ToolMenuItem[] {
  const meta = input.modelDetail.meta ?? {};
  const capabilities = (meta.capabilities ?? {}) as Record<string, unknown>;
  const modelToolIds = new Set((meta.toolIds as string[] | undefined) ?? []);
  const defaultFeatureIds = new Set((meta.defaultFeatureIds as string[] | undefined) ?? []);

  const builtins = Object.keys(builtinNames)
    .filter((id) => capabilities[id] === true || defaultFeatureIds.has(id))
    .map<ToolMenuItem>((id) => ({
      id,
      name: builtinNames[id],
      kind: "builtin",
      isEnabledByDefault: defaultFeatureIds.has(id)
    }));

  const tools = input.tools.map<ToolMenuItem>((tool) => ({
    id: tool.id,
    name: tool.name,
    description: tool.description,
    kind: "tool",
    isGlobal: tool.raw.is_global === true,
    isEnabledByDefault: tool.raw.is_global === true || modelToolIds.has(tool.id)
  }));

  const filters = input.functions
    .filter((fn) => fn.type === "filter" && fn.is_active === true)
    .filter((fn) => {
      const metaValue = fn.meta as Record<string, unknown> | undefined;
      return metaValue?.toggle === true || metaValue?.toggleable === true;
    })
    .map<ToolMenuItem>((fn) => ({
      id: String(fn.id),
      name: String(fn.name ?? fn.id),
      kind: "filter",
      isActive: true,
      isEnabledByDefault: true
    }));

  return [...builtins, ...tools, ...filters];
}

export function resolveToolsSelection(input: {
  menuItems: ToolMenuItem[];
  enabledIds: string[];
  disabledIds: string[];
}): ToolsSelection {
  const enabled = new Set(input.enabledIds);
  const disabled = new Set(input.disabledIds);
  const activeItems = input.menuItems.filter(
    (item) => (item.isEnabledByDefault || enabled.has(item.id)) && !disabled.has(item.id)
  );

  return {
    toolIds: activeItems.filter((item) => item.kind === "tool").map((item) => item.id),
    filterIds: activeItems.filter((item) => item.kind === "filter").map((item) => item.id),
    features: activeItems
      .filter((item) => item.kind === "builtin")
      .reduce(
        (features, item) => ({
          ...features,
          [item.id]: true
        }),
        { ...defaultFeatureFlags }
      )
  };
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/lib/runtime/toolsRuntime.test.ts src/lib/openwebui/client.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/openwebui/client.ts src/lib/openwebui/client.test.ts src/lib/runtime/toolsRuntime.ts src/lib/runtime/toolsRuntime.test.ts
git commit -m "feat: discover and resolve server tools"
```

## Task 3: Browser Tab Context

**Files:**
- Create: `src/content/extractPageContext.ts`
- Create: `src/lib/chrome/tabs.ts`
- Create: `src/lib/chrome/tabs.test.ts`
- Create: `src/lib/runtime/tabPrompt.ts`
- Create: `src/lib/runtime/tabPrompt.test.ts`

- [ ] **Step 1: Create extraction function**

Create `src/content/extractPageContext.ts`:

```ts
export type ExtractedPageContext = {
  selectedText: string;
  readableText: string;
};

export function extractPageContext(maxCharacters = 20_000): ExtractedPageContext {
  const selectedText = window.getSelection()?.toString().trim() ?? "";
  const blockedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS"]);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || blockedTags.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const chunks: string[] = [];
  let current = walker.nextNode();

  while (current && chunks.join("\n").length < maxCharacters) {
    chunks.push(current.textContent?.replace(/\s+/g, " ").trim() ?? "");
    current = walker.nextNode();
  }

  return {
    selectedText,
    readableText: chunks.join("\n").slice(0, maxCharacters)
  };
}
```

- [ ] **Step 2: Write tab service tests**

Create `src/lib/chrome/tabs.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { captureTabContext, listCurrentWindowTabs } from "./tabs";

describe("tabs", () => {
  it("lists current-window tabs with title, url, origin, favicon, and active state", async () => {
    chrome.tabs = {
      query: vi.fn(async () => [
        { id: 1, title: "Example", url: "https://example.com/page", favIconUrl: "https://example.com/favicon.ico", active: true }
      ])
    } as unknown as typeof chrome.tabs;

    await expect(listCurrentWindowTabs()).resolves.toEqual([
      {
        id: 1,
        title: "Example",
        url: "https://example.com/page",
        origin: "https://example.com",
        favIconUrl: "https://example.com/favicon.ico",
        isActive: true
      }
    ]);
  });

  it("marks restricted pages as unreadable while preserving title and url", async () => {
    const tab = {
      id: 1,
      title: "Chrome Settings",
      url: "chrome://settings",
      origin: "chrome://settings",
      isActive: true
    };

    await expect(captureTabContext(tab)).resolves.toMatchObject({
      title: "Chrome Settings",
      readableTextUnavailable: true,
      readableText: ""
    });
  });
});
```

- [ ] **Step 3: Implement tab service**

Create `src/lib/chrome/tabs.ts`:

```ts
import { CapturedTabContext, BrowserTabSummary } from "../openwebui/types";
import { extractPageContext } from "../../content/extractPageContext";

const MAX_TAB_TEXT = 20_000;

function toOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function isRestrictedUrl(url: string): boolean {
  return /^(chrome|chrome-extension|edge|about):/.test(url);
}

export async function listCurrentWindowTabs(): Promise<BrowserTabSummary[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter((tab) => typeof tab.id === "number" && typeof tab.url === "string")
    .map((tab) => ({
      id: tab.id as number,
      title: tab.title ?? tab.url ?? "Untitled tab",
      url: tab.url as string,
      origin: toOrigin(tab.url as string),
      favIconUrl: tab.favIconUrl,
      isActive: tab.active === true
    }));
}

export async function captureTabContext(tab: BrowserTabSummary): Promise<CapturedTabContext> {
  if (isRestrictedUrl(tab.url)) {
    return {
      ...tab,
      selectedText: "",
      readableText: "",
      readableTextUnavailable: true,
      truncated: false
    };
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContext,
      args: [MAX_TAB_TEXT]
    });
    const value = result.result as { selectedText?: string; readableText?: string } | undefined;
    const readableText = value?.readableText ?? "";

    return {
      ...tab,
      selectedText: value?.selectedText ?? "",
      readableText,
      readableTextUnavailable: false,
      truncated: readableText.length >= MAX_TAB_TEXT
    };
  } catch {
    return {
      ...tab,
      selectedText: "",
      readableText: "",
      readableTextUnavailable: true,
      truncated: false
    };
  }
}
```

- [ ] **Step 4: Write prompt injection tests**

Create `src/lib/runtime/tabPrompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { injectTabContext } from "./tabPrompt";

describe("tabPrompt", () => {
  it("adds visible tab context blocks before the user prompt", () => {
    const prompt = injectTabContext({
      prompt: "Summarize this.",
      tabs: [
        {
          id: 1,
          title: "Example",
          url: "https://example.com/page",
          origin: "https://example.com",
          isActive: true,
          selectedText: "selected",
          readableText: "readable",
          readableTextUnavailable: false,
          truncated: false
        }
      ]
    });

    expect(prompt).toContain("Context from selected browser tabs:");
    expect(prompt).toContain("Title: Example");
    expect(prompt).toContain("Selected text:\nselected");
    expect(prompt).toContain("User prompt:\nSummarize this.");
  });

  it("marks unavailable and truncated text visibly", () => {
    const prompt = injectTabContext({
      prompt: "Use this.",
      tabs: [
        {
          id: 2,
          title: "Restricted",
          url: "chrome://settings",
          origin: "chrome://settings",
          isActive: false,
          selectedText: "",
          readableText: "",
          readableTextUnavailable: true,
          truncated: true
        }
      ]
    });

    expect(prompt).toContain("Readable page text: unavailable");
    expect(prompt).toContain("[Readable page text was truncated to 20000 characters]");
  });
});
```

- [ ] **Step 5: Implement prompt injection**

Create `src/lib/runtime/tabPrompt.ts`:

```ts
import { CapturedTabContext } from "../openwebui/types";

export function injectTabContext(input: {
  prompt: string;
  tabs: CapturedTabContext[];
}): string {
  if (input.tabs.length === 0) {
    return input.prompt;
  }

  const blocks = input.tabs.map((tab, index) => {
    const readableText = tab.readableTextUnavailable
      ? "Readable page text: unavailable"
      : `Readable page text:\n${tab.readableText}`;
    const truncation = tab.truncated ? "\n[Readable page text was truncated to 20000 characters]" : "";

    return [
      `Tab ${index + 1}`,
      `Title: ${tab.title}`,
      `URL: ${tab.url}`,
      tab.selectedText ? `Selected text:\n${tab.selectedText}` : "Selected text: none",
      `${readableText}${truncation}`
    ].join("\n");
  });

  return ["Context from selected browser tabs:", ...blocks, "User prompt:", input.prompt].join("\n\n");
}
```

- [ ] **Step 6: Run tab tests**

Run: `npm test -- src/lib/chrome/tabs.test.ts src/lib/runtime/tabPrompt.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/content/extractPageContext.ts src/lib/chrome/tabs.ts src/lib/chrome/tabs.test.ts src/lib/runtime/tabPrompt.ts src/lib/runtime/tabPrompt.test.ts
git commit -m "feat: capture selected browser tab context"
```

## Task 4: Side Panel Chat UI

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/styles.css`
- Create: `src/sidepanel/App.test.tsx`
- Create: `src/lib/ui/markdown.ts`
- Create: `src/lib/ui/errors.ts`

- [ ] **Step 1: Add UI smoke tests**

Create `src/sidepanel/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the connection screen by default", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Connect server" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /connect/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Add markdown helper**

Create `src/lib/ui/markdown.ts`:

```ts
export function renderPlainMarkdown(markdown: string): string {
  return markdown
    .replace(/```([\s\S]*?)```/g, (_match, code) => `\n${String(code).trim()}\n`)
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(.*?)\]\((https?:\/\/.*?)\)/g, "$1 ($2)")
    .trim();
}
```

- [ ] **Step 3: Add UI error mapper**

Create `src/lib/ui/errors.ts`:

```ts
import { OpenWebUIError } from "../openwebui/types";

export function toUserFacingError(error: unknown): string {
  if (error instanceof OpenWebUIError) {
    switch (error.code) {
      case "AuthFailedError":
        return "The server rejected those credentials.";
      case "NotOpenWebUIError":
        return "That server does not look like an Open WebUI instance.";
      case "TokenExpiredError":
        return "Your session expired. Log in again.";
      case "ModelUnavailableError":
        return "The selected model is not available.";
      case "ServerUnreachableError":
        return "The server could not be reached.";
    }
  }

  return error instanceof Error ? error.message : "Something went wrong.";
}
```

- [ ] **Step 4: Update side panel UI responsibilities**

Modify `src/sidepanel/App.tsx` so it contains these state pieces and controls:

```ts
type PanelMode = "connect" | "welcome" | "chat" | "history" | "settings";

type ComposerState = {
  prompt: string;
  selectedToolIds: string[];
  disabledDefaultToolIds: string[];
  selectedTabs: CapturedTabContext[];
  isToolsOpen: boolean;
  isTabsOpen: boolean;
};
```

Add these UI elements:

```tsx
<header className="topBar">
  <button className="iconButton" type="button" aria-label="Recent chats">
    <History size={18} />
  </button>
  <select aria-label="Model">{/* server models */}</select>
  <button className="iconButton" type="button" aria-label="Settings">
    <Settings size={18} />
  </button>
</header>
```

Add composer controls:

```tsx
<footer className="composer">
  <div className="sharedTabs" aria-live="polite">
    {composer.selectedTabs.length > 0 ? `Sharing ${composer.selectedTabs.length} tabs` : null}
  </div>
  <textarea aria-label="Message" value={composer.prompt} onChange={handlePromptChange} />
  <div className="composerActions">
    <button type="button" aria-label="Tools" className="iconButton">
      <Wrench size={18} />
    </button>
    <button type="button" aria-label="Add tabs" className="iconButton">
      <PanelTop size={18} />
    </button>
    <button type="submit" aria-label="Send" className="sendButton">
      <Send size={18} />
    </button>
  </div>
</footer>
```

Wire send behavior so selected tabs are injected with `injectTabContext()` before `sendMessage()` is called. Pass `toolIds`, `filterIds`, and `features` from `resolveToolsSelection()` into the chat runtime.

- [ ] **Step 5: Update styles**

Add these selectors to `src/sidepanel/styles.css`:

```css
.iconButton,
.sendButton {
  width: 36px;
  height: 36px;
  border: 1px solid #34424f;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #171d23;
  color: #edf2f7;
  cursor: pointer;
}

.sendButton {
  border-color: #d6ecff;
  background: #d6ecff;
  color: #101418;
}

.composer {
  margin-top: auto;
  border-top: 1px solid #27313b;
  padding: 10px;
  display: grid;
  gap: 8px;
  background: #101418;
}

.composer textarea {
  width: 100%;
  min-height: 76px;
  resize: vertical;
  border: 1px solid #34424f;
  border-radius: 8px;
  padding: 10px;
  background: #171d23;
  color: #edf2f7;
}

.composerActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.composerActions .sendButton {
  margin-left: auto;
}

.sharedTabs {
  min-height: 18px;
  color: #9aa8b5;
  font-size: 12px;
}
```

- [ ] **Step 6: Run UI tests and build**

Run: `npm test -- src/sidepanel/App.test.tsx`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/styles.css src/sidepanel/App.test.tsx src/lib/ui/markdown.ts src/lib/ui/errors.ts
git commit -m "feat: add side panel chat controls"
```

## Task 5: Logout And Manual Acceptance Checklist

**Files:**
- Modify: `src/sidepanel/App.tsx`
- Create: `docs/manual-test-checklist.md`

- [ ] **Step 1: Wire logout**

In `src/sidepanel/App.tsx`, call `clearServerSession(activeServerId)` from `src/lib/chrome/storage.ts` when the user clicks logout. Clear in-memory model, chat, tools, tab, and stream state before returning to the connection screen.

Use this button in the settings view:

```tsx
<button type="button" className="dangerButton" onClick={handleLogout}>
  Log out
</button>
```

Add style:

```css
.dangerButton {
  min-height: 40px;
  border: 1px solid #8c2f39;
  border-radius: 8px;
  background: #2b1619;
  color: #ffb4ab;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 2: Create manual checklist**

Create `docs/manual-test-checklist.md`:

```md
# Manual Chrome Acceptance Checklist

## Install

- [ ] Run `npm run build`.
- [ ] Open `chrome://extensions`.
- [ ] Enable Developer Mode.
- [ ] Load unpacked extension from `dist`.
- [ ] Click the extension action.
- [ ] Confirm the Chrome side panel opens.

## Connect

- [ ] Enter the target Open WebUI server URL.
- [ ] Enter local email or username and password.
- [ ] Confirm login succeeds.
- [ ] Confirm password field is cleared after login.
- [ ] Confirm `chrome.storage.local` stores token and server URL but not password.
- [ ] Confirm invalid credentials show an auth error.
- [ ] Confirm unreachable server shows a connection error.

## Models And Chat

- [ ] Confirm model selector shows server models.
- [ ] Select a model.
- [ ] Start a new chat.
- [ ] Confirm assistant text streams incrementally.
- [ ] Confirm chat appears in Open WebUI website history.
- [ ] Open recent chats menu.
- [ ] Confirm recent chats show truncated titles.
- [ ] Select a recent chat.
- [ ] Confirm loaded messages match server history.
- [ ] Open More history.
- [ ] Confirm additional pages load when available.

## Tools

- [ ] Open tools menu.
- [ ] Confirm built-in toggles reflect server and model availability.
- [ ] Confirm custom tools exposed by the server are visible.
- [ ] Enable one custom tool.
- [ ] Send a prompt that should use the tool.
- [ ] Confirm request includes selected `tool_ids`.
- [ ] Confirm tool execution happens server-side.
- [ ] Confirm tool status or text output renders in the chat.

## Browser Tab Context

- [ ] Open Add tabs.
- [ ] Confirm current-window tabs show title, favicon, and current-tab label.
- [ ] Select the active tab.
- [ ] Confirm composer says `Sharing 1 tabs`.
- [ ] Send a prompt.
- [ ] Confirm outgoing prompt includes title, URL, selected text, and readable text.
- [ ] Select a restricted page such as `chrome://settings`.
- [ ] Confirm readable text is marked unavailable and chat can continue.
- [ ] Confirm readable text longer than 20,000 characters is truncated with a visible note.

## Logout

- [ ] Open settings.
- [ ] Click Log out.
- [ ] Confirm token and cached server data are cleared from local session storage.
- [ ] Confirm the connection screen is shown.
```

- [ ] **Step 3: Run full verification**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/styles.css docs/manual-test-checklist.md
git commit -m "feat: add logout and manual acceptance checklist"
```

## Self-Review

- PRD coverage: tools menu, server-side tool selection, selected-tab picker, visible sharing state, prompt injection, restricted page handling, 20,000-character cap, markdown/code rendering baseline, logout, and manual MVP acceptance criteria are covered.
- Technical design coverage: `/api/v1/tools/list`, `/api/v1/functions/`, model default feature resolution, `tool_ids`, `filter_ids`, explicit `features`, `chrome.tabs.query`, `chrome.scripting.executeScript`, visible tab context blocks, and error mapping are covered.
- Deferred to product follow-on work outside MVP: rich HTML artifacts, custom artifact viewers, audio/video outputs, Socket.IO if direct streaming fails in the proof harness, and broader non-active-tab host permissions.
- Placeholder scan: no placeholder terms are used as implementation instructions.
- Type consistency: `ToolMenuItem`, `ToolsSelection`, `BrowserTabSummary`, `CapturedTabContext`, `buildToolsMenu`, `resolveToolsSelection`, `listCurrentWindowTabs`, `captureTabContext`, and `injectTabContext` are introduced before UI usage.
