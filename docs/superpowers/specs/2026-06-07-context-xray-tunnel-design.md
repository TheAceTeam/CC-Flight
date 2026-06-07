# Context X-Ray Tunnel Design

## Summary

Run Atlas currently has a 3D terrain mode, but the terrain does not produce enough actionable developer insight. The next MVP should replace the 3D project terrain with a selected-run diagnostic called **Context X-Ray Tunnel**.

The 2D Insight Board remains the entry point for ranking suspicious or high-signal task journeys. When a developer selects an insight, the 3D view focuses on that single task journey and answers: **why is this run worth inspecting, where did context help or fail, and where did the evidence chain break?**

## Product Goal

The 3D view should stop behaving like a decorative replay map. It should become a compact diagnostic instrument for a single agent run.

Primary developer questions:

- What context entered this run?
- Which context appeared to influence tools, patches, verification, or final output?
- Which context looked unused or excessive?
- Did the agent get stuck in repeated tool loops?
- Did code change without matching verification evidence?
- Did an error recover, or did it remain a broken path?

## MVP Scope

The MVP uses existing frontend data only:

- `TaskJourney`
- `TaskJourneyDetail.events`
- `TaskJourneyDetail.causalEdges`
- `TimelineEvent.tokenUsage`
- `TimelineEvent.files`
- existing Run Atlas insight scoring

No backend schema migration is required for the MVP. Context influence is shown as inferred, not definitive.

## User Experience

Run Atlas keeps two layers:

1. **2D Insight Board**
   - Ranks task journeys by developer risk and review value.
   - Shows score, severity, metric bars, reasons, and suggested action.
   - Selecting an insight selects a journey for 3D inspection.

2. **3D Context X-Ray Tunnel**
   - Opens on the selected journey.
   - Renders a left-to-right diagnostic chain:
     `Prompt -> Context -> Tools -> Patch -> Verification -> Result`
   - Spatializes the selected insight:
     - Unused context floats away from the main chain.
     - Repeated tool calls stack into an orange loop tower.
     - Patch without verification creates a red broken bridge.
     - Error recovery creates a red hazard followed by a green/yellow recovery path.
     - High token burn thickens the relevant tunnel segment.

The 3D view should not try to show every project run. It should show one selected run clearly.

## X-Ray Data Model

Add a frontend model builder that derives `XRayModel` from an `AtlasRoute`, selected `AtlasInsight`, and optional `TaskJourneyDetail`.

Suggested types:

```ts
type XRayNodeType =
  | "prompt"
  | "context"
  | "tool"
  | "tool-loop"
  | "patch"
  | "verification"
  | "hazard"
  | "result"
  | "unused-context"
  | "broken-link";

interface XRayNode {
  id: string;
  eventIds: string[];
  type: XRayNodeType;
  title: string;
  detail: string | null;
  inferredReason: string;
  confidence: "direct" | "inferred";
  tokenTotal: number;
  files: string[];
  position: { x: number; y: number; z: number };
  weight: number;
}

interface XRayLink {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "temporal" | "causal" | "same-call" | "inferred" | "missing-evidence";
  confidence: "direct" | "inferred";
  strength: number;
}

interface XRayModel {
  journeyId: string;
  insightId: string | null;
  title: string;
  summary: string;
  nodes: XRayNode[];
  links: XRayLink[];
  diagnostics: XRayDiagnostic[];
}
```

## Inference Rules

The MVP should prefer explainable heuristics over hidden smartness.

- `Prompt`: first `user_prompt`, or journey prompt event.
- `Context`: `reasoning_marker`, `status`, tool results with long output, and assistant messages that appear before tool or patch activity.
- `Tool`: `tool_call` and `tool_result` pairs.
- `Tool Loop`: repeated tool names or repeated file/search/read operations within a short sequence.
- `Patch`: `file_change` events and tool calls/results whose extracted files include changed source paths.
- `Verification`: `verification` events and tool output with test/build/lint/typecheck markers.
- `Hazard`: `error` events and failed tool outputs.
- `Result`: final assistant message or journey end.
- `Unused Context`: context nodes that do not have a nearby causal/temporal path into tool, patch, verification, or result.
- `Broken Link`: patch or result nodes that lack a later verification event in the same journey.

Use existing causal edges where present:

- `same_call` becomes a direct link.
- `implements_prompt` becomes a direct or high-confidence inferred prompt-to-patch link.
- `verified_by` becomes a direct patch-to-verification link.
- `failed_by` becomes a direct hazard link.

If no causal edge exists, fall back to temporal adjacency and label the link as inferred.

## 3D Visual Semantics

Colors:

- Blue: prompt or source input
- Purple: context
- Orange: tool and tool loops
- Green: patch
- Yellow: verification
- Red: hazard, broken link, missing evidence
- White or warm gold: result

Geometry:

- Main chain is a tunnel or pipe from prompt to result.
- Context packets orbit or feed into the chain.
- Unused context floats outside the chain with faint links.
- Tool loops stack vertically to show churn.
- Missing verification is shown as a red broken bridge between patch and result.
- Selected node gets a visible halo and drives the inspector.

Motion:

- Subtle forward flow along the main chain.
- Active node pulses slowly.
- Broken links flicker softly, not aggressively.
- Tool loop tower has a small circular motion to suggest repeated work.

## Inspector

Clicking a 3D node updates the inspector with:

- node type
- title and detail
- inferred reason
- confidence label
- related event count
- files involved
- token usage when available
- suggested action

Suggested action examples:

- `Open missing verification evidence`
- `Inspect repeated tool calls`
- `Compare context packet with final patch`
- `Review recovery path after failed step`

The inspector must make clear when a relationship is inferred rather than direct evidence.

## Error And Empty States

- If no journey detail is loaded, render a summary-only X-Ray with prompt, stage summaries, and result.
- If WebGL fails, keep the 2D Insight Board and inspector usable.
- If a run has no risky signal, show a low-risk chain and explain that no broken evidence path was detected.
- If inferred links are weak, label them as inferred instead of overclaiming precision.

## Testing

Unit tests:

- Builds an X-Ray model from a patch-without-verification journey.
- Detects repeated tool loops.
- Marks context as unused when it does not connect to tool/patch/result.
- Uses direct causal edges when available and inferred links otherwise.
- Produces a fallback model when journey detail is missing.

E2E tests:

- Selecting an Insight Board card switches the selected X-Ray journey.
- 3D canvas renders nonblank.
- Clicking a 3D node updates the inspector.
- Patch-without-verification fixture shows a broken evidence diagnostic.
- WebGL fallback leaves the board and inspector readable.

## Non-Goals

- No backend context packet extraction in this MVP.
- No embeddings or semantic similarity scoring.
- No all-project 3D clustering.
- No full replay timeline in 3D.
- No claim that inferred links are ground truth.

## Acceptance Criteria

- The old 3D terrain no longer appears as the primary 3D concept.
- The selected 3D view is tied to one insight and one task journey.
- The view clearly exposes at least three actionable diagnostics:
  - unused or excessive context
  - tool loop pressure
  - missing verification after patch
- Inspector explains the selected node and whether its relationship is direct or inferred.
- Existing Run Atlas tests pass, and new X-Ray model tests cover the MVP inference rules.
