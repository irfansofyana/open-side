import type { CapturedTabContext } from "../openwebui/types";

export function injectTabContext({
  prompt,
  tabs
}: {
  prompt: string;
  tabs: CapturedTabContext[];
}): string {
  if (tabs.length === 0) {
    return prompt;
  }

  const blocks = tabs.map((tab, index) => {
    const selectedText = tab.selectedText
      ? `Selected text:\n${tab.selectedText}`
      : "Selected text: none";
    const readableText = tab.readableTextUnavailable
      ? "Readable page text: unavailable"
      : `Readable page text:\n${tab.readableText}`;
    const truncation = tab.truncated
      ? "\n[Readable page text was truncated to 20000 characters]"
      : "";

    return [
      `Tab ${index + 1}`,
      `Title: ${tab.title}`,
      `URL: ${tab.url}`,
      selectedText,
      `${readableText}${truncation}`
    ].join("\n");
  });

  return [
    "Context from selected browser tabs:",
    ...blocks,
    `User prompt:\n${prompt}`
  ].join("\n\n");
}
