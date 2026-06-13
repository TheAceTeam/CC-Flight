# Thread Master Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change Thread View into a master/details layout where user prompts are the left-side primary index in reverse chronological order, and the right detail pane shows the selected prompt's User -> agent process -> Codex interaction.

**Architecture:** Keep Atlas View untouched. `ui/src/App.tsx` keeps `viewMode === "atlas"` exactly on `RunAtlas`; only the `ConversationThread` branch gains selected-journey state, a master prompt list, and a detail pane that reuses `ConversationTurn`. Existing journey paging and detail loading behavior remain intact.

**Tech Stack:** React state, TypeScript, existing SuperView i18n dictionary, CSS grid/responsive layout, Playwright e2e.

---

### Task 1: E2E Contract

**Files:**
- Modify: `tests/e2e/superview.spec.ts`

- [ ] **Step 1: Write failing e2e expectations**

Add assertions after Thread View loads:

```ts
await expect(page.getByLabel("User input index")).toBeVisible();
await expect(page.getByLabel("Conversation details")).toBeVisible();
await expect(page.locator(".conversation-master-item").first()).toContainText("Build task journey from input 225");
await page.locator(".conversation-master-item").filter({ hasText: "Build task journey from input 75" }).click();
await expect(page.getByLabel("Conversation details")).toContainText("Build task journey from input 75");
await expect(page.getByLabel("Conversation details")).not.toContainText("Build task journey from input 225");
```

- [ ] **Step 2: Run e2e and verify RED**

Run:

```bash
pnpm exec playwright test tests/e2e/superview.spec.ts
```

Expected: fail because `User input index` and `Conversation details` do not exist yet.

---

### Task 2: Thread State and Layout

**Files:**
- Modify: `ui/src/App.tsx`

- [ ] **Step 1: Sort loaded journeys newest first for master list**

Inside `ConversationThread`, derive:

```ts
const orderedJourneys = [...journeys].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
```

- [ ] **Step 2: Track selected journey**

Add `selectedJourneyId` state and keep it valid when page data changes.

- [ ] **Step 3: Render master list**

Render `button.conversation-master-item` for each journey, showing title, duration, tokens, KV hit, and status.

- [ ] **Step 4: Render details pane**

Render only the selected `ConversationTurn` inside `section aria-label={copy.detailsAria}`.

---

### Task 3: Copy and Styles

**Files:**
- Modify: `ui/src/i18n.ts`
- Modify: `ui/src/styles.css`

- [ ] **Step 1: Add bilingual copy**

Add:

```ts
masterAria: string;
detailsAria: string;
masterTitle: string;
detailsTitle: string;
emptySelection: string;
```

- [ ] **Step 2: Add layout CSS**

Add:
- `.conversation-master-detail`
- `.conversation-master`
- `.conversation-master-list`
- `.conversation-master-item`
- `.conversation-detail-pane`

- [ ] **Step 3: Preserve mobile behavior**

Under `@media (max-width: 760px)`, collapse the layout to one column with master list above details.

---

### Task 4: Verification

Run:

```bash
pnpm exec playwright test tests/e2e/superview.spec.ts
pnpm test
pnpm build
git diff --check
```
