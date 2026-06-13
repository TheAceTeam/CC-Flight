# Context X-Ray Tunnel MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Run Atlas 3D mode from a replay terrain into a diagnostic Context X-Ray Tunnel that exposes context usage, tool-loop pressure, missing verification, and causal confidence for one selected run.

**Architecture:** Keep the existing 2D Insight Board as the entry point and add a pure model builder in `ui/src/runAtlasModel.ts` for X-Ray nodes, links, diagnostics, and suggested actions. `ui/src/RunAtlas.tsx` renders that model with Three.js and an inspector while using existing `TaskJourneyDetail.events`, `causalEdges`, and `AtlasInsight` data; no database or API migration is required.

**Tech Stack:** TypeScript, Vitest, React, Three.js, existing SuperView i18n copy dictionary, Playwright e2e expectations.

---

### Task 1: X-Ray Model Contract

**Files:**
- Modify: `tests/run-atlas-model.test.ts`
- Modify: `ui/src/runAtlasModel.ts`

- [ ] **Step 1: Write failing model tests**

Add tests that call `buildXRayModel({ route, insight, detail })` and assert:

```ts
expect(model.diagnostics.map((diagnostic) => diagnostic.type)).toContain("missing-verification");
expect(model.nodes.map((node) => node.type)).toContain("broken-link");
expect(model.links.some((link) => link.type === "missing-evidence")).toBe(true);
expect(model.nodes.find((node) => node.type === "tool-loop")?.eventIds.length).toBeGreaterThanOrEqual(3);
expect(model.nodes.map((node) => node.type)).toContain("unused-context");
expect(model.links.some((link) => link.confidence === "direct")).toBe(true);
```

- [ ] **Step 2: Run model tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/run-atlas-model.test.ts
```

Expected: fail because `buildXRayModel` and X-Ray types do not exist yet.

- [ ] **Step 3: Implement X-Ray types and builder**

Add exported types in `ui/src/runAtlasModel.ts`:

```ts
export type XRayNodeType = "prompt" | "context" | "unused-context" | "tool" | "tool-loop" | "patch" | "verification" | "hazard" | "broken-link" | "result";
export type XRayLinkType = "temporal" | "causal" | "same-call" | "inferred" | "missing-evidence";
export type XRayConfidence = "direct" | "inferred";
export type XRayDiagnosticType = "unused-context" | "tool-loop" | "missing-verification" | "error-recovery";
```

Implement `buildXRayModel` so it:
- uses loaded detail events when available and falls back to summary route nodes,
- groups repeated tool calls into a `tool-loop` node,
- marks context after patch with no causal edge as `unused-context`,
- creates a `broken-link` node and `missing-evidence` link when a patch has no later verification,
- preserves direct causal edges with `confidence: "direct"`,
- fills node inspector data: reason, confidence, event count, files, token total, suggested action.

- [ ] **Step 4: Run model tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/run-atlas-model.test.ts
```

Expected: all model tests pass.

---

### Task 2: 3D X-Ray Scene

**Files:**
- Modify: `ui/src/RunAtlas.tsx`

- [ ] **Step 1: Connect Run Atlas to `buildXRayModel`**

In `RunAtlas`, derive:

```ts
const activeDetail = activeRoute ? detailsByJourneyId[activeRoute.journeyId] ?? null : null;
const xrayModel = useMemo(
  () => (activeRoute ? buildXRayModel({ route: activeRoute, insight: activeInsight, detail: activeDetail }) : null),
  [activeDetail, activeInsight, activeRoute]
);
```

- [ ] **Step 2: Replace 3D terrain rebuild with X-Ray scene rebuild**

Add scene helpers that render:
- main tunnel from prompt to result,
- floating unused context nodes,
- stacked tool-loop nodes,
- red broken verification bridge,
- selected-node halo and avatar movement.

- [ ] **Step 3: Route clicks to selected X-Ray node**

When a mesh has `userData.xrayNode`, update `activeXRayNodeId` and call `onSelectNode({ journeyId, eventId })` with the first related event.

- [ ] **Step 4: Run TypeScript check**

Run:

```bash
pnpm exec tsc --noEmit
```

Expected: no TypeScript errors.

---

### Task 3: X-Ray Inspector, Copy, and Styles

**Files:**
- Modify: `ui/src/RunAtlas.tsx`
- Modify: `ui/src/i18n.ts`
- Modify: `ui/src/styles.css`
- Modify: `tests/e2e/run-atlas.spec.ts`

- [ ] **Step 1: Add bilingual copy**

Add English and Chinese copy keys for:
- `insightXray`
- `xrayTitle`
- `xraySubtitle`
- `xrayDiagnostics`
- `xrayScoreboard`
- `focusBrokenLink`
- `confidence`
- `direct`
- `inferred`
- `relatedEvents`
- `xraySuggestedAction`

- [ ] **Step 2: Render X-Ray inspector**

Add a compact inspector that shows:
- selected node type/title/detail,
- inferred reason,
- confidence,
- related event count,
- files,
- token usage,
- suggested action,
- diagnostic cards.

- [ ] **Step 3: Style X-Ray-specific surfaces**

Add CSS classes for:
- `.xray-diagnostic-strip`
- `.xray-diagnostic`
- `.xray-inspector-grid`
- `.xray-confidence-pill`
- `.xray-file-list`

- [ ] **Step 4: Update e2e expectations**

Update `tests/e2e/run-atlas.spec.ts` to click `3D X-Ray Tunnel` and assert visible `Context X-Ray Tunnel`, diagnostics, and nonblank canvas.

---

### Task 4: Verification

**Files:**
- Test only

- [ ] **Step 1: Run focused model tests**

```bash
pnpm exec vitest run tests/run-atlas-model.test.ts
```

- [ ] **Step 2: Run full unit test suite**

```bash
pnpm test
```

- [ ] **Step 3: Build production bundle**

```bash
pnpm build
```

- [ ] **Step 4: Run Run Atlas e2e when browser binary is available**

```bash
pnpm exec playwright test tests/e2e/run-atlas.spec.ts
```

If Playwright browser binaries are missing, record the exact failure and verify the UI through build plus any available browser preview.
