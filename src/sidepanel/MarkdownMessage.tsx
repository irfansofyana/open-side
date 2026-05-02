import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

type MarkdownMessageProps = {
  content: string;
};

type MessageSegment =
  | { type: "markdown"; content: string }
  | { type: "reasoning"; content: string; duration?: string; summary?: string };

const reasoningPattern = new RegExp(
  [
    '<details\\s+[^>]*type=["\\\']reasoning["\\\'][^>]*>[\\s\\S]*?<\\/details>',
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

const stripMarkdownHtml = (value: string): string =>
  value
    .replace(/<\/?details[^>]*>/gi, "")
    .replace(/<\/?summary[^>]*>/gi, "")
    .replace(/<\/?(think|thinking|reason|reasoning|thought)>/gi, "")
    .replace(/<\|begin_of_thought\|>/gi, "")
    .replace(/<\|end_of_thought\|>/gi, "")
    .trim();

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

const parseMessageSegments = (content: string): MessageSegment[] => {
  const segments: MessageSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(reasoningPattern)) {
    const index = match.index ?? 0;
    const before = content.slice(lastIndex, index);

    if (before.trim()) {
      segments.push({ type: "markdown", content: before });
    }

    segments.push(parseReasoningSegment(match[0]));
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
        ) : (
          <MarkdownBody content={segment.content} key={`${segment.type}-${index}`} />
        )
      )}
    </div>
  );
}
