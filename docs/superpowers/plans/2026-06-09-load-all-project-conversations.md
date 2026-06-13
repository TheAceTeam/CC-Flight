# Load All Project Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load all conversations for the selected project in one timeline request and remove timeline pagination controls from the UI.

**Architecture:** Keep the existing timeline API contract but request a large project-level limit with `offset=0`. Remove frontend pagination state/actions/UI so Thread View and Atlas View both receive the same complete `taskJourneys` array.

**Tech Stack:** React, TypeScript, existing Express timeline API, Playwright e2e.

---

### Task 1: E2E Contract

**Files:**
- Modify: `tests/e2e/superview.spec.ts`

- [ ] **Step 1: Write failing e2e expectations**

Assert the timeline request uses `offset=0`, a project-level limit larger than one page, all five fixture journeys appear in the master list, and `Prev page` / `Next page` buttons are absent.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec playwright test tests/e2e/superview.spec.ts --grep "scans fixture"
```

Expected: fail because the app still requests `limit=300`, paginates to offset 300, and renders pagination controls.

---

### Task 2: Frontend Loading

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Replace page limit**

Change `TIMELINE_LIMIT` to a project-level constant:

```ts
const PROJECT_TIMELINE_LIMIT = 100000;
```

- [ ] **Step 2: Remove pagination state/actions**

Remove `timelineOffset`, `loadNextTimelinePage`, `loadPreviousTimelinePage`, `hasPreviousPage`, and `hasNextPage`.

- [ ] **Step 3: Always load offset zero**

Call:

```ts
fetchTimeline(projectId, { limit: PROJECT_TIMELINE_LIMIT, offset: 0 })
```

- [ ] **Step 4: Remove page buttons**

Keep the loaded count and view switch, but remove `Prev page` and `Next page` buttons.

---

### Task 3: Verification

Run:

```bash
pnpm exec playwright test tests/e2e/superview.spec.ts --grep "scans fixture"
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/superview.spec.ts tests/e2e/run-atlas.spec.ts
git diff --check
```
