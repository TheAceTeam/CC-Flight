# 2D X-Ray Tunnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 2D X-Ray Tunnel mode to Run Atlas so developers can inspect the same causal context graph without entering the 3D scene.

**Architecture:** Reuse `buildXRayModel` from `ui/src/runAtlasModel.ts` as the single source of truth. `ui/src/RunAtlas.tsx` gets a third preview mode that renders X-Ray nodes and links as a horizontal 2D tunnel, shares selection state with the 3D mode, and keeps `XRayInspector` as the diagnostic detail panel.

**Tech Stack:** React, TypeScript, existing SuperView i18n dictionary, CSS grid/flex layout, Playwright e2e, Vitest model coverage already in place.

---

### Task 1: 2D X-Ray E2E Contract

**Files:**
- Modify: `tests/e2e/run-atlas.spec.ts`

- [ ] **Step 1: Write failing e2e expectations**

Add assertions that:

```ts
await page.getByRole("button", { name: "2D X-Ray Tunnel" }).click();
await expect(page.getByRole("heading", { name: "2D X-Ray Tunnel" })).toBeVisible();
await expect(page.getByLabel("2D X-Ray causal tunnel")).toContainText("Broken link");
await expect(page.getByLabel("X-Ray Inspector")).toContainText("Broken link");
```

- [ ] **Step 2: Run e2e and verify RED**

Run:

```bash
pnpm exec playwright test tests/e2e/run-atlas.spec.ts
```

Expected: fail because `2D X-Ray Tunnel` button/view does not exist yet.

---

### Task 2: Run Atlas 2D X-Ray Mode

**Files:**
- Modify: `ui/src/RunAtlas.tsx`

- [ ] **Step 1: Add preview mode**

Change:

```ts
type InsightPreviewMode = "board" | "terrain";
```

to:

```ts
type InsightPreviewMode = "board" | "xray2d" | "terrain";
```

- [ ] **Step 2: Add mode button**

Add a button labeled `copy.insightXray2d` between Insight Board and 3D X-Ray.

- [ ] **Step 3: Render `XRayTunnel2D`**

Create a component that renders:
- ordered X-Ray nodes as connected chips,
- direct/inferred/missing-evidence links,
- diagnostic badges,
- off-path unused context as an upper branch,
- active node highlighting,
- click-to-select behavior using `selectXRayNode`.

- [ ] **Step 4: Reuse `XRayInspector`**

Render `XRayInspector` for both `previewMode === "xray2d"` and `previewMode === "terrain"`.

---

### Task 3: Copy, Styles, and Verification

**Files:**
- Modify: `ui/src/i18n.ts`
- Modify: `ui/src/styles.css`

- [ ] **Step 1: Add bilingual copy**

Add:

```ts
insightXray2d: string;
xray2dTitle: string;
xray2dSubtitle: string;
xray2dAria: string;
```

- [ ] **Step 2: Add CSS**

Add stable responsive styles for:
- `.xray-2d-board`
- `.xray-2d-tunnel`
- `.xray-2d-node`
- `.xray-2d-link`
- `.xray-2d-branch`
- `.xray-2d-diagnostics`

- [ ] **Step 3: Verify**

Run:

```bash
pnpm exec vitest run tests/run-atlas-model.test.ts
pnpm test
pnpm build
pnpm exec playwright test tests/e2e/run-atlas.spec.ts
git diff --check
```
