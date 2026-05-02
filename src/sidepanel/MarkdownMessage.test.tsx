import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { MarkdownMessage } from "./MarkdownMessage";

test("MarkdownMessage renders common assistant markdown", () => {
  render(
    <MarkdownMessage
      content={[
        "## Plan",
        "",
        "- First item",
        "- Second item",
        "",
        "Use `inline code` here.",
        "",
        "```ts",
        "console.log('hello');",
        "```",
        "",
        "[Open WebUI](https://openwebui.com)"
      ].join("\n")}
    />
  );

  expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByText("inline code")).toBeInTheDocument();
  expect(document.querySelector("code.language-ts")).toHaveTextContent("console.log('hello');");
  expect(screen.getByRole("link", { name: "Open WebUI" })).toHaveAttribute(
    "href",
    "https://openwebui.com"
  );
});

test("MarkdownMessage does not render raw HTML as HTML", () => {
  render(<MarkdownMessage content={"<script>alert('xss')</script>\n\n<strong>bold</strong>"} />);

  expect(document.querySelector("script")).not.toBeInTheDocument();
  expect(document.querySelector("strong")).not.toBeInTheDocument();
  expect(screen.getByText(/alert\('xss'\)/)).toBeInTheDocument();
  expect(screen.getByText(/bold/)).toBeInTheDocument();
});

test("MarkdownMessage renders GFM tables and task lists", () => {
  render(
    <MarkdownMessage
      content={[
        "- [x] Persist chat",
        "- [ ] Add tools",
        "",
        "| Feature | State |",
        "| --- | --- |",
        "| Markdown | Working |"
      ].join("\n")}
    />
  );

  expect(screen.getByRole("checkbox", { name: /Persist chat/ })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Add tools/ })).not.toBeChecked();
  expect(screen.getByRole("table")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Feature" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Working" })).toBeInTheDocument();
});

test("MarkdownMessage renders backed citations as clickable sources", () => {
  render(
    <MarkdownMessage
      content="The minister is Purbaya [1]. Another marker [2] stays plain."
      sources={[
        {
          documents: ["Reuters reported the appointment from Jakarta."],
          index: 1,
          metadata: [{ source: "Reuters", url: "https://example.com/reuters" }],
          name: "Reuters",
          url: "https://example.com/reuters"
        }
      ]}
    />
  );

  const inlineCitation = screen.getByRole("button", { name: "Reuters citation 1" });

  expect(inlineCitation).toHaveTextContent("1");
  expect(inlineCitation).not.toHaveTextContent("Reuters");
  expect(screen.getByText(/Another marker \[2\] stays plain/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Show 1 Source" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open source 1: Reuters" })).not.toBeInTheDocument();

  fireEvent.click(inlineCitation);

  expect(screen.getByRole("button", { name: "Hide 1 Source" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );
  expect(screen.getByRole("heading", { name: "Reuters" })).toBeInTheDocument();
  expect(screen.getByText("Reuters reported the appointment from Jakarta.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "https://example.com/reuters" })).toHaveAttribute(
    "href",
    "https://example.com/reuters"
  );
});

test("MarkdownMessage keeps long inline citation titles compact", () => {
  render(
    <MarkdownMessage
      content="Coverage was reported [1]."
      sources={[
        {
          documents: ["Long source snippet."],
          index: 1,
          metadata: [{ title: "Gibran completes first year in largely symbolic role" }],
          name: "Gibran completes first year in largely symbolic role - Politics - The Jakarta Post",
          url: "https://example.com/long-source"
        }
      ]}
    />
  );

  const inlineCitation = screen.getByRole("button", {
    name: "Gibran completes first year in largely symbolic role - Politics - The Jakarta Post citation 1"
  });

  expect(inlineCitation).toHaveTextContent("1");
  expect(inlineCitation).not.toHaveTextContent("Gibran");
});

test("MarkdownMessage toggles selected citation details", () => {
  render(
    <MarkdownMessage
      content="Taiwan president context [1][2]."
      sources={[
        {
          documents: ["First source snippet."],
          index: 1,
          metadata: [{ title: "First source", source: "https://example.com/first" }],
          name: "First source",
          url: "https://example.com/first"
        },
        {
          documents: ["Second source snippet."],
          index: 2,
          metadata: [{ title: "Second source", source: "https://example.com/second" }],
          name: "Second source",
          url: "https://example.com/second"
        }
      ]}
    />
  );

  const sourcesToggle = screen.getByRole("button", { name: "Show 2 Sources" });

  expect(sourcesToggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("button", { name: "Open source 1: First source" })).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Citation details")).not.toBeInTheDocument();

  fireEvent.click(sourcesToggle);

  expect(screen.getByRole("button", { name: "Hide 2 Sources" })).toHaveAttribute(
    "aria-expanded",
    "true"
  );

  const firstSource = screen.getByRole("button", { name: "Open source 1: First source" });
  const secondSource = screen.getByRole("button", { name: "Open source 2: Second source" });

  fireEvent.click(firstSource);

  expect(firstSource).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "First source" })).toBeInTheDocument();

  fireEvent.click(secondSource);

  expect(firstSource).toHaveAttribute("aria-pressed", "false");
  expect(secondSource).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("heading", { name: "First source" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Second source" })).toBeInTheDocument();

  fireEvent.click(secondSource);

  expect(secondSource).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByLabelText("Citation details")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Hide 2 Sources" }));

  expect(screen.getByRole("button", { name: "Show 2 Sources" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );
  expect(screen.queryByRole("button", { name: "Open source 1: First source" })).not.toBeInTheDocument();
});

test("MarkdownMessage renders Open WebUI reasoning details safely", () => {
  render(
    <MarkdownMessage
      content={[
        '<details type="reasoning" done="true" duration="2">',
        "<summary>Thought for 2 seconds</summary>",
        "",
        "> I checked the requirements.",
        "",
        "</details>",
        "",
        "Final answer."
      ].join("\n")}
    />
  );

  const details = screen.getByTestId("reasoning-details");

  expect(details).toHaveAttribute("data-duration", "2");
  expect(screen.getByText("Thought for 2 seconds")).toBeInTheDocument();
  expect(screen.getByText("I checked the requirements.")).toBeInTheDocument();
  expect(screen.getByText("Final answer.")).toBeInTheDocument();
  expect(document.querySelector("script")).not.toBeInTheDocument();
});

test("MarkdownMessage renders Open WebUI thinking tags as reasoning blocks", () => {
  render(
    <MarkdownMessage
      content={[
        "<think>",
        "Check the docs before coding.",
        "</think>",
        "",
        "<reasoning>Compare the formats.</reasoning>",
        "",
        "Final answer."
      ].join("\n")}
    />
  );

  const details = screen.getAllByTestId("reasoning-details");

  expect(details).toHaveLength(2);
  expect(screen.getByText("Check the docs before coding.")).toBeInTheDocument();
  expect(screen.getByText("Compare the formats.")).toBeInTheDocument();
  expect(screen.getByText("Final answer.")).toBeInTheDocument();
});

test("MarkdownMessage renders Open WebUI tool call details safely", () => {
  render(
    <MarkdownMessage
      content={[
        '<details type="tool_calls" done="true" id="toolu_bdrk_01GFuqUeFvJtXh9zVow9yMLs" name="get_current_timestamp" arguments="&quot;{}&quot;" files="" embeds="&quot;&quot;">',
        "<summary>Tool Executed</summary>",
        '&quot;{\\&quot;current_timestamp\\&quot;: 1777736872, \\&quot;current_iso\\&quot;: \\&quot;2026-05-02T15:47:52.919622+00:00\\&quot;, \\&quot;user_local_iso\\&quot;: \\&quot;2026-05-02T22:47:52.919622+07:00\\&quot;, \\&quot;user_timezone\\&quot;: \\&quot;Asia/Jakarta\\&quot;}&quot;',
        "</details>",
        "It's currently **10:47 PM**."
      ].join(" ")}
    />
  );

  const details = screen.getByTestId("tool-call-details");

  expect(details).toHaveAttribute("data-tool-name", "get_current_timestamp");
  expect(screen.getByText("Tool Executed: get_current_timestamp")).toBeInTheDocument();
  expect(screen.getByText("Arguments")).toBeInTheDocument();
  expect(screen.getByText("Result")).toBeInTheDocument();
  expect(
    Array.from(document.querySelectorAll("code.language-json")).some((code) =>
      code.textContent?.includes('"user_timezone": "Asia/Jakarta"')
    )
  ).toBe(true);
  expect(screen.getByText(/It's currently/)).toBeInTheDocument();
  expect(document.querySelector("script")).not.toBeInTheDocument();
});

test("MarkdownMessage prefers tool call body over metadata content attributes", () => {
  render(
    <MarkdownMessage
      content={[
        '<details type="tool_calls" done="true" content="[{&quot;type&quot;:&quot;function&quot;,&quot;function&quot;:{&quot;name&quot;:&quot;dice_roll&quot;}}]">',
        "<summary>Tool Executed</summary>",
        "",
        "> dice_roll: 16",
        "</details>"
      ].join("\n")}
    />
  );

  expect(screen.getByTestId("tool-call-details")).toBeInTheDocument();
  expect(screen.getByText("dice_roll: 16")).toBeInTheDocument();
  expect(screen.queryByText(/"type": "function"/)).not.toBeInTheDocument();
});

test("MarkdownMessage highlights fenced code blocks", () => {
  render(
    <MarkdownMessage
      content={[
        "```go",
        "package main",
        "",
        "func main() {",
        "  println(\"hello\")",
        "}",
        "```"
      ].join("\n")}
    />
  );

  const code = document.querySelector("code.language-go");

  expect(code).toHaveClass("hljs");
  expect(code).toHaveClass("language-go");
  expect(code).toHaveTextContent("package main");
});
