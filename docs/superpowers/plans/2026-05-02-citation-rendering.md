# Citation Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render Open WebUI citations as real clickable source references instead of leaving `[1]` markers as plain text.

**Architecture:** Capture citation/source events in the Open WebUI stream adapter, normalize persisted message citation metadata from refetched chats, carry sources through `DisplayChatMessage`, then let the markdown renderer replace backed `[n]` markers with buttons and render a source list below the assistant answer. Unbacked citation-looking text remains plain markdown text.

**Tech Stack:** TypeScript, React, React Testing Library, Vitest, existing Open WebUI runtime/client modules.

---

### Task 1: Citation Event Parsing

**Files:**
- Modify: `src/lib/openwebui/types.ts`
- Modify: `src/lib/openwebui/stream.ts`
- Test: `src/lib/openwebui/stream.test.ts`

- [x] **Step 1: Write the failing test**

Add a stream parser test for an Open WebUI citation event:

```ts
expect(
  parseSSELine(
    'data: {"type":"citation","data":{"document":["Article text"],"metadata":[{"source":"Reuters","url":"https://example.com"}],"source":{"name":"Reuters","url":"https://example.com"}}}'
  )
).toEqual({
  type: "citation",
  citation: {
    documents: ["Article text"],
    metadata: [{ source: "Reuters", url: "https://example.com" }],
    name: "Reuters",
    url: "https://example.com"
  }
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/openwebui/stream.test.ts`

Expected: FAIL because `citation` stream events are not parsed.

- [x] **Step 3: Write minimal implementation**

Add `CitationSource` and `StreamEvent` citation variant in `types.ts`, then parse `type: "citation"` and `type: "source"` in `stream.ts`.

- [x] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/openwebui/stream.test.ts`

Expected: PASS.

### Task 2: Runtime Citation Carrying

**Files:**
- Modify: `src/lib/runtime/chatRuntime.ts`
- Test: `src/lib/runtime/chatRuntime.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving `sendStreamingMessage`, `sendPersistedMessage`, and `loadChatForDisplay` include `sources` on assistant display messages/results when citation data is available.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/runtime/chatRuntime.test.ts`

Expected: FAIL because runtime results do not expose sources.

- [x] **Step 3: Write minimal implementation**

Accumulate citation stream events, extract persisted citations from common message fields such as `sources`, `citations`, `metadata.sources`, and `metadata.citations`, and add `sources` to `DisplayChatMessage` plus send results.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/runtime/chatRuntime.test.ts`

Expected: PASS.

### Task 3: Citation UI Rendering

**Files:**
- Modify: `src/sidepanel/MarkdownMessage.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/styles.css`
- Test: `src/sidepanel/MarkdownMessage.test.tsx`
- Test: `src/sidepanel/App.test.tsx`

- [x] **Step 1: Write failing UI tests**

Add tests proving backed `[1]` markers become clickable buttons, the sources row appears below the assistant answer, and clicking a source reveals the title/url/snippet detail.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/sidepanel/MarkdownMessage.test.tsx src/sidepanel/App.test.tsx`

Expected: FAIL because sources are not rendered.

- [x] **Step 3: Write minimal implementation**

Pass `sources` into `MarkdownMessage`, replace backed citation markers with source buttons, render a compact source list, and show citation details when selected.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/sidepanel/MarkdownMessage.test.tsx src/sidepanel/App.test.tsx`

Expected: PASS.

### Task 4: Verification And Docs

**Files:**
- Modify: `docs/TECHNICAL_DESIGN.md`
- Modify: `docs/superpowers/plans/2026-05-02-ui-improvements-todo.md`

- [x] **Step 1: Update docs**

Document that Open WebUI `citation`/`source` events and persisted message citation metadata are normalized into clickable source UI.

- [x] **Step 2: Run full verification**

Run:

```bash
npm test
npm run lint
git diff --check
npm run smoke:build
```

Expected: all commands exit 0. The Vite chunk-size warning may still appear.
