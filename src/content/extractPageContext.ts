export type ExtractedPageContext = {
  selectedText: string;
  readableText: string;
};

export function extractPageContext(maxCharacters = 20_000): ExtractedPageContext {
  const selectedText = window.getSelection()?.toString().trim() ?? "";
  const blockedTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS"]);
  const root = document.body;

  if (!root) {
    return {
      readableText: "",
      selectedText
    };
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;

      if (!parent || blockedTags.has(parent.tagName)) {
        return NodeFilter.FILTER_REJECT;
      }

      return node.textContent?.trim()
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    }
  });
  const chunks: string[] = [];
  let totalLength = 0;
  let current = walker.nextNode();

  while (current && totalLength < maxCharacters) {
    const text = current.textContent?.replace(/\s+/g, " ").trim() ?? "";

    if (text) {
      chunks.push(text);
      totalLength += text.length + 1;
    }

    current = walker.nextNode();
  }

  return {
    readableText: chunks.join("\n").slice(0, maxCharacters),
    selectedText
  };
}
