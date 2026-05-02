import { extractPageContext } from "../../content/extractPageContext";
import type { BrowserTabSummary, CapturedTabContext } from "../openwebui/types";

const MAX_TAB_TEXT = 20_000;
const restrictedUrlPattern = /^(about|chrome|chrome-extension|edge|moz-extension|view-source):/i;

const toOrigin = (url: string): string => {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
};

const isRestrictedUrl = (url: string): boolean => restrictedUrlPattern.test(url);

const toOptionalHostOriginPattern = (url: string): string | undefined => {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return undefined;
    }

    return `${parsedUrl.origin}/*`;
  } catch {
    return undefined;
  }
};

const requestTabOriginPermission = async (tab: BrowserTabSummary): Promise<boolean> => {
  const originPattern = toOptionalHostOriginPattern(tab.url);

  if (!originPattern) {
    return false;
  }

  try {
    const alreadyGranted = await chrome.permissions.contains({
      origins: [originPattern]
    });

    if (alreadyGranted) {
      return true;
    }

    return await chrome.permissions.request({
      origins: [originPattern]
    });
  } catch {
    return false;
  }
};

const unavailableTabContext = (tab: BrowserTabSummary): CapturedTabContext => ({
  ...tab,
  readableText: "",
  readableTextUnavailable: true,
  selectedText: "",
  truncated: false
});

export async function listCurrentWindowTabs(): Promise<BrowserTabSummary[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });

  return tabs.flatMap((tab) => {
    if (typeof tab.id !== "number" || typeof tab.url !== "string") {
      return [];
    }

    return [
      {
        favIconUrl: tab.favIconUrl,
        id: tab.id,
        isActive: tab.active === true,
        origin: toOrigin(tab.url),
        title: tab.title?.trim() || tab.url,
        url: tab.url
      }
    ];
  });
}

export async function captureTabContext(tab: BrowserTabSummary): Promise<CapturedTabContext> {
  if (isRestrictedUrl(tab.url)) {
    return unavailableTabContext(tab);
  }

  const hasPermission = await requestTabOriginPermission(tab);

  if (!hasPermission) {
    return unavailableTabContext(tab);
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      args: [MAX_TAB_TEXT],
      func: extractPageContext,
      target: { tabId: tab.id }
    });
    const extracted = result.result;
    const readableText =
      typeof extracted?.readableText === "string" ? extracted.readableText : "";
    const selectedText =
      typeof extracted?.selectedText === "string" ? extracted.selectedText : "";

    return {
      ...tab,
      readableText,
      readableTextUnavailable: false,
      selectedText,
      truncated: readableText.length >= MAX_TAB_TEXT
    };
  } catch {
    return unavailableTabContext(tab);
  }
}
