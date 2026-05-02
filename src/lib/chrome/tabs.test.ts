import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureTabContext, listCurrentWindowTabs } from "./tabs";
import type { BrowserTabSummary } from "../openwebui/types";

describe("browser tab context", () => {
  const permissions = {
    contains: vi.fn(),
    request: vi.fn()
  };

  beforeEach(() => {
    permissions.contains.mockReset();
    permissions.request.mockReset();
    Object.assign(chrome, { permissions });
  });

  it("lists current-window tabs with useful metadata", async () => {
    chrome.tabs = {
      query: vi.fn(async () => [
        {
          active: true,
          favIconUrl: "https://example.com/favicon.ico",
          id: 101,
          title: "Example Page",
          url: "https://example.com/docs/page"
        },
        {
          active: false,
          id: 102,
          title: "",
          url: "https://docs.example.test/guide"
        }
      ])
    } as unknown as typeof chrome.tabs;

    await expect(listCurrentWindowTabs()).resolves.toEqual([
      {
        favIconUrl: "https://example.com/favicon.ico",
        id: 101,
        isActive: true,
        origin: "https://example.com",
        title: "Example Page",
        url: "https://example.com/docs/page"
      },
      {
        id: 102,
        isActive: false,
        origin: "https://docs.example.test",
        title: "https://docs.example.test/guide",
        url: "https://docs.example.test/guide"
      }
    ]);
  });

  it("captures selected text and readable page text from an allowed tab", async () => {
    const tab: BrowserTabSummary = {
      id: 101,
      isActive: true,
      origin: "https://example.com",
      title: "Example Page",
      url: "https://example.com/docs/page"
    };
    chrome.scripting = {
      executeScript: vi.fn(async () => [
        {
          result: {
            readableText: "Readable page content",
            selectedText: "selected words"
          }
        }
      ])
    } as unknown as typeof chrome.scripting;
    permissions.contains.mockResolvedValue(false);
    permissions.request.mockResolvedValue(true);

    await expect(captureTabContext(tab)).resolves.toEqual({
      ...tab,
      readableText: "Readable page content",
      readableTextUnavailable: false,
      selectedText: "selected words",
      truncated: false
    });
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ["https://example.com/*"]
    });
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ["https://example.com/*"]
    });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        args: [20_000],
        target: { tabId: 101 }
      })
    );
  });

  it("uses an already granted origin permission without asking again", async () => {
    const tab: BrowserTabSummary = {
      id: 101,
      isActive: true,
      origin: "https://example.com",
      title: "Example Page",
      url: "https://example.com/docs/page"
    };
    chrome.scripting = {
      executeScript: vi.fn(async () => [
        {
          result: {
            readableText: "Readable page content",
            selectedText: ""
          }
        }
      ])
    } as unknown as typeof chrome.scripting;
    permissions.contains.mockResolvedValue(true);

    await expect(captureTabContext(tab)).resolves.toMatchObject({
      readableText: "Readable page content",
      readableTextUnavailable: false,
      title: "Example Page"
    });
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ["https://example.com/*"]
    });
    expect(permissions.request).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).toHaveBeenCalled();
  });

  it("does not inject into a web tab when origin permission is denied", async () => {
    const tab: BrowserTabSummary = {
      id: 101,
      isActive: false,
      origin: "https://example.com",
      title: "Example Page",
      url: "https://example.com/docs/page"
    };
    chrome.scripting = {
      executeScript: vi.fn()
    } as unknown as typeof chrome.scripting;
    permissions.contains.mockResolvedValue(false);
    permissions.request.mockResolvedValue(false);

    await expect(captureTabContext(tab)).resolves.toMatchObject({
      readableText: "",
      readableTextUnavailable: true,
      selectedText: "",
      title: "Example Page",
      url: "https://example.com/docs/page"
    });
    expect(permissions.contains).toHaveBeenCalledWith({
      origins: ["https://example.com/*"]
    });
    expect(permissions.request).toHaveBeenCalledWith({
      origins: ["https://example.com/*"]
    });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("marks a web tab unavailable when the origin permission request fails", async () => {
    const tab: BrowserTabSummary = {
      id: 101,
      isActive: true,
      origin: "https://example.com",
      title: "Example Page",
      url: "https://example.com/docs/page"
    };
    chrome.scripting = {
      executeScript: vi.fn()
    } as unknown as typeof chrome.scripting;
    permissions.contains.mockResolvedValue(false);
    permissions.request.mockRejectedValue(new Error("This function must be called during a user gesture"));

    await expect(captureTabContext(tab)).resolves.toMatchObject({
      readableText: "",
      readableTextUnavailable: true,
      selectedText: "",
      title: "Example Page",
      url: "https://example.com/docs/page"
    });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it("marks restricted and injection-failed tabs as unavailable while preserving title and url", async () => {
    const restrictedTab: BrowserTabSummary = {
      id: 1,
      isActive: true,
      origin: "chrome://settings",
      title: "Chrome Settings",
      url: "chrome://settings"
    };
    const blockedTab: BrowserTabSummary = {
      id: 2,
      isActive: false,
      origin: "https://blocked.example",
      title: "Blocked",
      url: "https://blocked.example"
    };
    chrome.scripting = {
      executeScript: vi.fn(async () => {
        throw new Error("Cannot access contents of the page");
      })
    } as unknown as typeof chrome.scripting;
    permissions.contains.mockResolvedValue(false);
    permissions.request.mockResolvedValue(true);

    await expect(captureTabContext(restrictedTab)).resolves.toMatchObject({
      readableText: "",
      readableTextUnavailable: true,
      selectedText: "",
      title: "Chrome Settings",
      url: "chrome://settings"
    });
    await expect(captureTabContext(blockedTab)).resolves.toMatchObject({
      readableText: "",
      readableTextUnavailable: true,
      selectedText: "",
      title: "Blocked",
      url: "https://blocked.example"
    });
    expect(permissions.request).toHaveBeenCalledTimes(1);
  });
});
