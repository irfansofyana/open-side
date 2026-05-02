import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
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

function MarkdownBody({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        a: ({ children, node: _node, ...props }) => (
          <a {...props} rel="noreferrer" target="_blank">
            {children}
          </a>
        ),
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
      {content}
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

export function MarkdownMessage({ content }: MarkdownMessageProps) {
  const segments = parseMessageSegments(content);

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
          <MarkdownBody content={segment.content} key={`${segment.type}-${index}`} />
        )
      )}
    </div>
  );
}
