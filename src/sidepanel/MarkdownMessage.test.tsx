import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";

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
