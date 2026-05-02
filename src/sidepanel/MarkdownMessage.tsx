import {
  Children,
  cloneElement,
  isValidElement,
  useMemo,
  useState,
  type ReactNode
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

import type { CitationSource } from "../lib/openwebui/types";

type MarkdownMessageProps = {
  content: string;
  sources?: CitationSource[];
};

type MessageSegment =
  | { type: "markdown"; content: string }
  | { type: "reasoning"; content: string; duration?: string; summary?: string }
  | {
      type: "toolCall";
      arguments?: string;
      id?: string;
      name?: string;
      result?: string;
      resultIsJson: boolean;
      summary?: string;
    };

const blockPattern = new RegExp(
  [
    '<details\\s+[^>]*type=["\\\']reasoning["\\\'][^>]*>[\\s\\S]*?<\\/details>',
    '<details\\s+[^>]*type=["\\\']tool_calls["\\\'][^>]*>[\\s\\S]*?<\\/details>',
    "<think>[\\s\\S]*?<\\/think>",
    "<thinking>[\\s\\S]*?<\\/thinking>",
    "<reason>[\\s\\S]*?<\\/reason>",
    "<reasoning>[\\s\\S]*?<\\/reasoning>",
    "<thought>[\\s\\S]*?<\\/thought>",
    "<\\|begin_of_thought\\|>[\\s\\S]*?<\\|end_of_thought\\|>"
  ].join("|"),
  "gi"
);

const getAttribute = (value: string, name: string): string | undefined => {
  const match = value.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));

  return match?.[1];
};

const decodeHtmlEntities = (value: string): string => {
  if (typeof document === "undefined") {
    return value
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;

  return textarea.value;
};

const stripMarkdownHtml = (value: string): string =>
  decodeHtmlEntities(
    value
      .replace(/<\/?details[^>]*>/gi, "")
      .replace(/<\/?summary[^>]*>/gi, "")
      .replace(/<\/?(think|thinking|reason|reasoning|thought)>/gi, "")
      .replace(/<\|begin_of_thought\|>/gi, "")
      .replace(/<\|end_of_thought\|>/gi, "")
  ).trim();

const parseStructuredText = (
  value: string | undefined
): { content: string; isJson: boolean } | undefined => {
  let content = value ? decodeHtmlEntities(value).trim() : "";

  if (!content) {
    return undefined;
  }

  for (let index = 0; index < 3; index += 1) {
    try {
      const parsed = JSON.parse(content) as unknown;

      if (typeof parsed === "string") {
        content = parsed.trim();
        continue;
      }

      return {
        content: JSON.stringify(parsed, null, 2),
        isJson: true
      };
    } catch {
      break;
    }
  }

  return {
    content,
    isJson: false
  };
};

const parseReasoningSegment = (raw: string): MessageSegment => {
  if (/^<details/i.test(raw)) {
    const summaryMatch = raw.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
    const summary = summaryMatch ? stripMarkdownHtml(summaryMatch[1]) : undefined;
    const withoutSummary = raw.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, "");

    return {
      type: "reasoning",
      content: stripMarkdownHtml(withoutSummary),
      duration: getAttribute(raw, "duration"),
      summary
    };
  }

  return {
    type: "reasoning",
    content: stripMarkdownHtml(raw)
  };
};

const parseToolCallSegment = (raw: string): MessageSegment => {
  const summaryMatch = raw.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i);
  const summary = summaryMatch ? stripMarkdownHtml(summaryMatch[1]) : undefined;
  const withoutSummary = raw.replace(/<summary[^>]*>[\s\S]*?<\/summary>/i, "");
  const explicitResult = getAttribute(raw, "result") ?? getAttribute(raw, "results");
  const bodyResult = parseStructuredText(stripMarkdownHtml(withoutSummary));
  const result =
    parseStructuredText(explicitResult) ??
    bodyResult ??
    parseStructuredText(getAttribute(raw, "content"));

  return {
    type: "toolCall",
    arguments: parseStructuredText(getAttribute(raw, "arguments"))?.content,
    id: getAttribute(raw, "id"),
    name: getAttribute(raw, "name"),
    result: result?.content,
    resultIsJson: result?.isJson ?? false,
    summary
  };
};

const parseBlockSegment = (raw: string): MessageSegment => {
  if (/^<details\s+[^>]*type=["']tool_calls["']/i.test(raw)) {
    return parseToolCallSegment(raw);
  }

  return parseReasoningSegment(raw);
};

const parseMessageSegments = (content: string): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(blockPattern)) {
    const index = match.index ?? 0;
    const before = content.slice(lastIndex, index);

    if (before.trim()) {
      segments.push({ type: "markdown", content: before });
    }

    segments.push(parseBlockSegment(match[0]));
    lastIndex = index + match[0].length;
  }

  const after = content.slice(lastIndex);

  if (after.trim() || segments.length === 0) {
    segments.push({ type: "markdown", content: after });
  }

  return segments;
};

const getTextContent = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }

      if (isValidElement<{ children?: ReactNode }>(child)) {
        return getTextContent(child.props.children);
      }

      return "";
    })
    .join("")
    .trim();

const applyCitationLinks = (content: string, sources: CitationSource[]): string => {
  if (sources.length === 0) {
    return content;
  }

  const sourceByIndex = new Map(sources.map((source) => [source.index, source]));
  let isFencedCode = false;

  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        isFencedCode = !isFencedCode;
        return line;
      }

      if (isFencedCode) {
        return line;
      }

      return line.replace(/\[(\d+)\]/g, (match, value) => {
        const source = sourceByIndex.get(Number(value));

        return source ? `[${source.index}](#citation-${source.index})` : match;
      });
    })
    .join("\n");
};

function MarkdownBody({
  content,
  onCitationSelect,
  selectedSourceIndex,
  sources = []
}: {
  content: string;
  onCitationSelect?: (source: CitationSource) => void;
  selectedSourceIndex?: number;
  sources?: CitationSource[];
}) {
  const sourceByIndex = useMemo(
    () => new Map(sources.map((source) => [source.index, source])),
    [sources]
  );
  const renderedContent = useMemo(
    () => applyCitationLinks(content, sources),
    [content, sources]
  );

  return (
    <ReactMarkdown
      components={{
        a: ({ children, href, node: _node, ...props }) => {
          const citationMatch = href?.match(/^#citation-(\d+)$/);
          const source = citationMatch ? sourceByIndex.get(Number(citationMatch[1])) : undefined;

          if (source) {
            return (
              <button
                aria-label={`${source.name} citation ${source.index}`}
                aria-pressed={source.index === selectedSourceIndex}
                className="citation-link"
                onClick={() => onCitationSelect?.(source)}
                type="button"
              >
                {source.index}
              </button>
            );
          }

          return (
            <a {...props} href={href} rel="noreferrer" target="_blank">
              {children}
            </a>
          );
        },
        li: ({ children, node: _node, ...props }) => {
          const label = getTextContent(children);
          const nextChildren = Children.map(children, (child) => {
            if (
              isValidElement<{ checked?: boolean; disabled?: boolean; type?: string }>(child) &&
              child.type === "input" &&
              child.props.type === "checkbox"
            ) {
              return cloneElement(child, { "aria-label": label } as Record<string, unknown>);
            }

            return child;
          });

          return <li {...props}>{nextChildren}</li>;
        }
      }}
      rehypePlugins={[rehypeHighlight]}
      remarkPlugins={[remarkGfm]}
    >
      {renderedContent}
    </ReactMarkdown>
  );
}

function ToolCallDetails({
  segment
}: {
  segment: Extract<MessageSegment, { type: "toolCall" }>;
}) {
  const summary = segment.name
    ? `${segment.summary ?? "Tool Executed"}: ${segment.name}`
    : segment.summary ?? "Tool Executed";

  return (
    <details
      className="tool-call-details"
      data-tool-id={segment.id}
      data-tool-name={segment.name}
      data-testid="tool-call-details"
    >
      <summary>{summary}</summary>
      <div className="tool-call-content">
        {segment.arguments ? (
          <section className="tool-call-section" aria-label="Tool arguments">
            <p className="tool-call-label">Arguments</p>
            <MarkdownBody content={`\`\`\`json\n${segment.arguments}\n\`\`\``} />
          </section>
        ) : null}
        {segment.result ? (
          <section className="tool-call-section" aria-label="Tool result">
            <p className="tool-call-label">Result</p>
            <MarkdownBody
              content={
                segment.resultIsJson
                  ? `\`\`\`json\n${segment.result}\n\`\`\``
                  : segment.result
              }
            />
          </section>
        ) : null}
      </div>
    </details>
  );
}

export function MarkdownMessage({ content, sources = [] }: MarkdownMessageProps) {
  const [areSourcesOpen, setAreSourcesOpen] = useState(false);
  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number>();
  const segments = parseMessageSegments(content);
  const selectedSource =
    selectedSourceIndex === undefined
      ? undefined
      : sources.find((source) => source.index === selectedSourceIndex);
  const sourcesLabel = `${sources.length} ${sources.length === 1 ? "Source" : "Sources"}`;
  const handleCitationSelect = (source: CitationSource) => {
    const nextSourceIndex = selectedSourceIndex === source.index ? undefined : source.index;

    setSelectedSourceIndex(nextSourceIndex);

    if (nextSourceIndex !== undefined) {
      setAreSourcesOpen(true);
    }
  };
  const handleSourcesToggle = () => {
    const nextIsOpen = !areSourcesOpen;

    setAreSourcesOpen(nextIsOpen);

    if (!nextIsOpen) {
      setSelectedSourceIndex(undefined);
    }
  };

  return (
    <div className="markdown-message">
      {segments.map((segment, index) =>
        segment.type === "reasoning" ? (
          <details
            className="reasoning-details"
            data-duration={segment.duration}
            data-testid="reasoning-details"
            key={`${segment.type}-${index}`}
          >
            <summary>{segment.summary ?? "Thinking"}</summary>
            <div className="reasoning-content">
              <MarkdownBody content={segment.content} />
            </div>
          </details>
        ) : segment.type === "toolCall" ? (
          <ToolCallDetails key={`${segment.type}-${index}`} segment={segment} />
        ) : (
          <MarkdownBody
            content={segment.content}
            key={`${segment.type}-${index}`}
            onCitationSelect={handleCitationSelect}
            selectedSourceIndex={selectedSourceIndex}
            sources={sources}
          />
        )
      )}
      {sources.length > 0 ? (
        <div className="citation-sources" aria-label="Sources">
          <button
            aria-expanded={areSourcesOpen}
            className="citation-sources-toggle"
            onClick={handleSourcesToggle}
            type="button"
          >
            <span className="citation-sources-toggle-label">
              {areSourcesOpen ? "Hide" : "Show"} {sourcesLabel}
            </span>
          </button>
          {areSourcesOpen ? (
            <>
              <div className="citation-source-list">
                {sources.map((source) => (
                  <button
                    aria-label={`Open source ${source.index}: ${source.name}`}
                    aria-pressed={selectedSourceIndex === source.index}
                    className="citation-source-button"
                    key={`${source.index}-${source.url ?? source.name}`}
                    onClick={() => handleCitationSelect(source)}
                    type="button"
                  >
                    <span className="citation-source-index">{source.index}</span>
                    <span className="citation-source-name">{source.name}</span>
                  </button>
                ))}
              </div>
              {selectedSource ? (
                <section className="citation-detail" aria-label="Citation details">
                  <h3>{selectedSource.name}</h3>
                  {selectedSource.url ? (
                    <a href={selectedSource.url} rel="noreferrer" target="_blank">
                      {selectedSource.url}
                    </a>
                  ) : null}
                  {selectedSource.documents[0] ? <p>{selectedSource.documents[0]}</p> : null}
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
