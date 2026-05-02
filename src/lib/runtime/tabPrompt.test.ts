import { describe, expect, it } from "vitest";

import { injectTabContext } from "./tabPrompt";
import type { CapturedTabContext } from "../openwebui/types";

describe("tab prompt injection", () => {
  it("leaves the prompt unchanged when no tabs are selected", () => {
    expect(injectTabContext({ prompt: "Explain this.", tabs: [] })).toBe("Explain this.");
  });

  it("adds visible selected-tab context blocks before the user prompt", () => {
    const tabs: CapturedTabContext[] = [
      {
        id: 101,
        isActive: true,
        origin: "https://example.com",
        readableText: "Readable page text.",
        readableTextUnavailable: false,
        selectedText: "selected text",
        title: "Example Page",
        truncated: false,
        url: "https://example.com/docs"
      }
    ];

    const prompt = injectTabContext({ prompt: "Summarize it.", tabs });

    expect(prompt).toContain("Context from selected browser tabs:");
    expect(prompt).toContain("Tab 1");
    expect(prompt).toContain("Title: Example Page");
    expect(prompt).toContain("URL: https://example.com/docs");
    expect(prompt).toContain("Selected text:\nselected text");
    expect(prompt).toContain("Readable page text:\nReadable page text.");
    expect(prompt).toContain("User prompt:\nSummarize it.");
  });

  it("marks unavailable and truncated readable text visibly", () => {
    const tabs: CapturedTabContext[] = [
      {
        id: 1,
        isActive: false,
        origin: "chrome://settings",
        readableText: "",
        readableTextUnavailable: true,
        selectedText: "",
        title: "Chrome Settings",
        truncated: true,
        url: "chrome://settings"
      }
    ];

    const prompt = injectTabContext({ prompt: "Use what you can.", tabs });

    expect(prompt).toContain("Selected text: none");
    expect(prompt).toContain("Readable page text: unavailable");
    expect(prompt).toContain("[Readable page text was truncated to 20000 characters]");
  });
});
