# Design System - CC Flight

## Product Context
- **What this is:** CC Flight is a complex-engineering timeline tool that reconstructs a project from its beginning to the present. Codex logs, git history, docs, tests, releases, user interruptions, and verification evidence become one continuous development timeline. Individual Codex runs can still open as side-scrolling replay levels.
- **Who it is for:** Codex users and engineering teams who want to understand how a complex project actually evolved: what decisions were made, where implementation drifted, when work was verified, where risk accumulated, and which agent runs moved the project forward.
- **Space/industry:** AI developer tools, coding-agent observability, LLM tracing, and developer workflow debugging.
- **Project type:** Engineering timeline dashboard with game-like replay drill-downs. The foundation is a from-start-to-now project timeline; the platformer view is a memorable detail view for individual runs or episodes.
- **Memorable thing:** "Wow, I have never seen a coding agent from this angle."

## Research Notes
Current LLM observability products converge on trace inspection, spans, evals, prompt links, costs, and alerts:

- [LangSmith observability](https://docs.langchain.com/oss/python/langchain/observability) frames agent visibility around tool calls, prompts, decisions, traces, debugging, evaluation, and monitoring.
- [Langfuse core concepts](https://langfuse.com/docs/observability/data-model) organize LLM activity into observations, traces, and sessions.
- [Braintrust trace inspection](https://www.braintrust.dev/docs/observe/examine-traces) supports hierarchy, timeline, conversation, raw trace, rerun, and share views.
- [Helicone sessions](https://docs.helicone.ai/features/sessions) and [session replay](https://docs.helicone.ai/guides/cookbooks/replay-session) emphasize session metadata, tracking, logging, and replay for AI agent calls.

The category baseline is useful but visually predictable: tables, trace trees, cost charts, and provider metrics. CC Flight should keep those fundamentals, but its own face should be the "agent flight recorder": a dashboard that makes a coding session feel like a navigable object with geography, causality, and replay.

Gamification references worth borrowing from:

- [Habitica](https://github.com/HabitRPG/habitica) makes progress participatory through quests, streaks, parties, and lightweight rewards tied to real tasks.
- [Exercism](https://github.com/exercism/website) uses track progress, exercises, mentoring, and iteration to make practice feel guided rather than lonely.
- [freeCodeCamp](https://github.com/freeCodeCamp/freeCodeCamp) turns learning into a path of small challenges, projects, and visible certification milestones.
- [Moodle badges](https://docs.moodle.org/en/Badges) show how badges can represent evidence-backed achievements instead of empty decoration.

CC Flight should make complex engineering work legible first. The product’s foundation is a timeline that answers: how did this project get here? The game layer then makes individual runs and episodes replayable.

## Product Model
- **Project Timeline:** The highest-level object. It spans from project start to now and combines commits, Codex sessions, docs, plans, tests, releases, deploys, user corrections, and unresolved risks.
- **Episode:** A meaningful chunk of engineering work: discovery, architecture, feature build, bug hunt, refactor, integration, QA, deploy, rollback, or product pivot.
- **Milestone:** A durable state change: first working demo, architecture decision, core feature complete, test suite green, deployment, customer feedback, or release.
- **Run:** A single Codex or agent session. Runs are timeline events and can open into the platformer replay.
- **Evidence:** Concrete proof attached to timeline nodes: diffs, command output, screenshots, test logs, build logs, docs, PRs, commits, and final answers.
- **Risk Thread:** A risk that persists across time: missing tests, unresolved design ambiguity, unstable integration, product-frame drift, or verification gaps.
- **Narrative Layer:** Auto-generated summary of what changed, why it changed, and what remains uncertain across the project lifecycle.

## Game Concept
- **Game title inside the product:** CC Flight: Agent Run.
- **Primary inspiration:** Classic side-scrolling platformers, especially the instantly understood structure of a run: start, obstacles, jumps, power-ups, checkpoints, hazards, boss moments, and a finish flag.
- **Secondary inspiration:** Automation/factory games. A small subsystem shows how context, file reads, patches, tests, and verification flow through a pipeline.
- **Prototype IP posture:** For the current concept prototype, CC Flight may lean directly into Mario-like platformer language and visual placeholders: bricks, coins, pipes, mushrooms, flags, pits, and side-scrolling level structure. Final production IP treatment can be resolved later by the project owner.
- **Fantasy:** You are watching a coding agent run a level made from your repo and task. The agent must gather enough context, jump across tool calls, patch code, survive tests, and reach a verified finish.
- **Core loop:** Pick a run, replay the side-scrolling level, inspect obstacles, see where the agent lost momentum, collect artifacts, compare alternate routes, and save the behavior pattern.
- **Session as level:** Every Codex log is a playable level. Short clean sessions become speedrun levels; messy sessions become obstacle courses; failed sessions become challenge levels.
- **Win condition:** The agent reaches the verification flag with enough proof: tests, build, browser QA, or explicit residual-risk notes.
- **Soft-fail condition:** The run reaches the end without proof, falls into repeated failure pits, loops on the same obstacle, or needs user rescue.
- **Progression:** Player ranks move from Runner, Route Mapper, Build Jumper, Failure Dodger, to Replay Master.
- **Replay value:** Re-run a session as a level using different overlays: time route, tool-call route, failure route, diff route, context route, and factory-flow route.
- **Multiplayer/team mode:** Teams can compare routes for the same task and ask why one agent cleared the level faster or with better proof.
- **Design constraint:** It must feel like a clever developer game, not a Mario clone and not a dashboard with toy stickers.
- **Scope boundary:** Agent Run is a drill-down view. It should not replace the project timeline. The timeline is the primary foundation for complex engineering.

## Aesthetic Direction
- **Direction:** Warm Engineering Command Center.
- **Reference adaptation:** Borrow the Evreghen Command Center structure: warm off-white workspace, dark frosted application shell, compact system typography, restrained cards, and orange telemetry accents.
- **Decoration level:** Controlled. The timeline is the base operational surface. The Mario-like replay remains a playful embedded module, but it should sit inside the command center rather than dominate the whole UI.
- **Mood:** Focused, technical, premium, and slightly playful at drill-down moments. It should feel like a serious engineering operations interface with a replayable game artifact inside it.
- **Core visual metaphor:** The project is a command timeline. Episodes are operational phases. Risks are telemetry ribbons. Agent runs are playable level recordings embedded in the command center.

## Safe Choices
- **Dense dashboard layout:** Codex users expect fast scanning, filtering, and drill-down behavior.
- **Trace and span vocabulary:** Keep familiar concepts like runs, traces, sessions, tools, tests, and errors.
- **Neutral-heavy UI:** The product needs long-session readability and low visual fatigue.

## Risks Worth Taking
- **Platformer-first session view:** Make the level map the primary object, with transcript and raw log as secondary details. This is the main "new angle" moment.
- **Mario-like readability:** For this prototype, use recognizable platformer elements so developers understand the metaphor immediately.
- **Factory mini-map:** Add a small automation strip that explains how context, patches, tests, and verification move through the agent pipeline.
- **Playable replay mechanic:** Let users scrub or auto-play the agent sprite through the level. The user sees momentum, stalls, loops, and rescue moments.

## Typography
- **Primary typeface:** `ui-sans-serif, system-ui, sans-serif`. Use system fonts for speed, operational clarity, and native dashboard feel.
- **Data/Tables:** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` with `font-variant-numeric: tabular-nums`.
- **Code:** System monospace stack.
- **Loading:** No external font required. Avoid editorial or geometric webfonts in the command-center direction.
- **Scale:** 12px meta labels, 13px dense labels, 14px tables, 16px body, 18px panel titles, 24px section titles, 32px view titles, 64-96px only for rare brand/landing moments.

## Color
- **Approach:** Warm neutral workspace plus concentrated orange telemetry. Orange should drive action, active state, timeline emphasis, replay progression, focus rings, and telemetry bars.
- **Background:** `#FCFAF7` - warm off-white workspace.
- **Surface:** `#F3F4F6` - neutral app panels.
- **Surface Soft:** `#EDEBE9` - muted containers and low-emphasis panels.
- **Surface Elevated:** `#FFFFFF` - cards and dialogs.
- **Text:** `#423D38` - main foreground.
- **Muted Text:** `#797067` - metadata and secondary labels.
- **Outline:** `#E3E0DD`; **Strong Outline:** `#D1D5DC`.
- **Primary Orange:** `#FE6E00`; **Strong Orange:** `#FF6B00`; **Warm Orange:** `#FFB74D`; **Focus Orange:** `#F97015`.
- **Shell Base:** black at 70% opacity with 12px blur; shell text is white or white at reduced opacity.
- **Semantic:** success `#00C758`, warning `#EDB200`, danger `#FB2C36`, info `#3080FF`.
- **Status badges:** mock pale yellow, planned soft gray, development pale blue, integrated pale lavender, production pale green.
- **Theme strategy:** Users can switch between Bright Command Center and Dark Command Center. Bright stays the default identity: warm off-white workspace with dark frosted shell. Dark uses deep warm brown/charcoal workspace surfaces while keeping the black frosted shell and orange telemetry language.

## Color Experiments
- **A - Command Center Baseline:** Current `design-preview.html` should follow warm workspace + dark frosted shell + orange telemetry.
- **B - Bright Arcade:** `design-preview-color-bright.html`. Light sky, clean white panels, saturated blue/teal/orange, brighter platformer elements. Useful as a high-energy comparison, but less aligned with the command-center reference.
- **C - Dark Neon:** `design-preview-color-dark.html`. Dark navy surfaces, neon teal/cobalt/amber, high-contrast level elements. Useful for developer focus comparison, but it should not replace the default light workspace identity.
- **Primary test metric:** Which version makes users faster to understand "complex engineering timeline with playable agent-run drill-down".
- **Guardrail:** The winning palette must keep timeline lanes, risk threads, code snippets, and replay controls readable without visual fatigue.
- **Selected implementation:** `design-preview.html` includes a Bright/Dark theme toggle with persisted user choice. Both themes keep the same command-center structure rather than switching to arcade/neon visual systems.

## Spacing
- **Base unit:** 4px.
- **Density:** Compact-comfortable. The app is data-rich, but rows should not feel cramped during long debugging sessions.
- **Scale:** 2xs 2px, xs 4px, sm 8px, md 16px, lg 24px, xl 32px, 2xl 48px, 3xl 64px.
- **Panel padding:** 16px for dense panels, 24px for primary view containers.
- **Row height:** 36px for tables, 44px for session list rows, 56px for selected summary rows.

## Layout
- **Approach:** Grid-disciplined application shell with one memorable map-first center view.
- **Primary screen:** Left session list, center trace map/replay canvas, right event inspector.
- **Secondary screen:** Transcript plus raw event stream, with synchronized highlight from the map.
- **Tertiary screen:** Run comparison view for before/after agent behavior.
- **Grid:** 12-column desktop shell; tablet collapses inspector below center view; mobile becomes stacked tabs.
- **Max content width:** No global max width for the app shell. Marketing/documentation pages can use 1160px.
- **Border radius:** sm 4px, md 8px, lg 12px only for modals and large empty states, full 9999px for avatars/toggles only.
- **Cards:** Use cards only for repeated items, modals, and framed tools. Do not put cards inside cards.

## Motion
- **Approach:** Replay-driven motion.
- **Where motion belongs:** The agent sprite moving through the level, replay scrubber, selected-node focus, trace expansion, synchronized transcript highlight, factory belt progression, hazard reactions, patch boosts, finish-flag states, and diff reveal.
- **Where motion does not belong:** Decorative page entrances, looping background effects, bouncing icons, or animated gradient fills.
- **Duration:** micro 80ms, short 160ms, medium 240ms.
- **Easing:** enter `cubic-bezier(.16,1,.3,1)`, exit `cubic-bezier(.7,0,.84,0)`, move `cubic-bezier(.65,0,.35,1)`.
- **Selected prototype direction:** Variant C - Replay-driven motion. The main `Play run` interaction animates the agent through Codex events and lights up the factory belt step by step.

## Game Layer
- **Principle:** Game mechanics must increase understanding. Never reward blind activity, random clicks, or vanity usage.
- **Tone:** Developer arcade, replay analyzer, speedrun route map, and build pipeline. Avoid cartoon RPG visuals, confetti overload, childish copy, and gambling-like reward loops.
- **Core loop:** Pick a run, replay the level, inspect jumps and hazards, identify stalls, compare routes, verify the finish, and save the pattern.
- **Objectives:** Small level goals such as "Clear without user rescue", "Find first failure pit", "Collect all context blocks", "Reach verified flag", "Avoid repeated loop trap", and "Compare two routes".
- **Badges:** Evidence-based achievements such as "First Clear", "Tool Route Mapper", "Failure Pit Spotter", "Verification Flag Runner", "Loop Breaker", and "Context Collector".
- **Streaks:** Count days with at least one meaningful review, not days opening the app. A meaningful review requires replay inspection, saved annotation, or a completed route comparison.
- **Progression:** Use level titles tied to user skill: Runner, Route Mapper, Build Jumper, Failure Dodger, Replay Master.
- **Collections:** Let users build a Pattern Library from marked runs: repeated failure modes, successful agent strategies, tool-use patterns, and verification habits.
- **Collaboration:** Teams can run "route rooms" where multiple users compare the same task across agents and pick the best clear.
- **Rewards:** Use subtle completion marks, route stamps, unlocked overlays, and pattern cards. Avoid loot boxes, global leaderboards, and manipulative scarcity.
- **Failure states:** Failed tests, blocked tasks, and user corrections are valuable hazards. Present them as learnable terrain, not user failure.

## Game Screens
- **Run Select:** A board of playable Codex runs with difficulty, estimated clear time, hidden pattern count, and verification status.
- **Level Briefing:** The opening state: user goal, branch, files involved, model, visible hazards, and finish condition.
- **Agent Run Level:** The main side-scrolling map. Users replay the agent sprite across platforms, hazards, gates, loops, and finish flags.
- **Factory Strip:** A compact automation view showing context input, file read, patch, test, browser QA, and final answer flowing through belts.
- **Artifact Inventory:** Collected snippets: command outputs, diffs, user messages, browser screenshots, test failures, and final answer claims.
- **Route Review:** Shows score, missed hazards, alternate routes, unlocked overlays, and pattern cards.
- **Pattern Codex:** A collection book of recurring agent behaviors discovered across runs.

## Core Components
- **Project Timeline:** Primary view. Shows the full engineering story from project start to now, with episodes, milestones, runs, risks, releases, and verification evidence.
- **Timeline Lanes:** Parallel lanes for Product decisions, Architecture, Code changes, Agent runs, Verification, Deploys, and Risks.
- **Episode Cards:** Collapsible summaries of meaningful work phases, each with start/end dates, goal, changed files, decisions, verification, and unresolved questions.
- **Milestone Markers:** Durable project states such as "first playable prototype", "core parser shipped", "design pivot", "test suite green", or "deployed to staging".
- **Risk Threads:** Long-running ribbons that connect related risks across episodes until resolved.
- **Evidence Drawer:** A side panel for the selected timeline event with commits, diffs, logs, screenshots, tests, docs, and final claims.
- **Narrative Summary:** A generated executive/engineering summary of the selected time range: what happened, why, proof, risk, and next likely work.
- **Run Ledger:** Filterable left rail with level title, branch, model, difficulty, duration, outcome, and hidden pattern count.
- **Agent Sprite:** A small original character/marker representing the coding agent. It must look like a developer cursor, bot helmet, or terminal avatar, not a plumber or known game character.
- **Level Map:** The signature game view. Shows planning, file reads, patches, tests, browser checks, user interruptions, retries, and verification as side-scrolling terrain.
- **Hazard Inspector:** Right panel for the selected hazard or platform with raw text, derived meaning, affected files, command output, and follow-up links.
- **Replay Scrubber:** Time axis that animates the agent through the level and highlights transcript events in lockstep.
- **Route Lens:** Unlockable overlays for time, tools, failures, diffs, context, and proof.
- **Factory Strip:** A small belt-based visualization for workflow causality: context -> read -> patch -> test -> verify -> answer.
- **Diff Ribbon:** Horizontal strip showing file-level churn and where patches landed in the session.
- **Finish Flag Strip:** Final quality evidence: tests run, lint/build result, unverified claims, blocked steps, and residual risk.
- **Objective Stack:** A compact panel of level goals for the current run, each tied to real replay inspection or annotation.
- **Artifact Inventory:** A persistent inventory of snippets the player collected during the run.
- **Clear Meter:** Shows whether the run has enough proof to count as a verified clear.
- **Badge Ledger:** A user's evidence-backed achievements with the session, timestamp, and behavior pattern that earned each badge.
- **Pattern Codex:** Saved findings from reviewed runs, searchable by model, repo, failure type, tool, or user correction.

## Content Style
- Use direct labels: "Read file", "Patched", "Test failed", "User interrupted", "Retried", "Verified".
- Avoid vague labels like "AI insight", "magic", "smart", or "enhanced".
- Prefer event claims that can be traced to log evidence.
- Use timestamps and counts when possible.
- Game copy should stay grounded: "Level clear", "Route saved", "Proof flag reached", "Loop trap found". Do not use childish praise.

## Accessibility
- All diagnostic color must have a text or shape cue.
- Interactive nodes need keyboard focus states.
- Replay controls need visible labels and predictable tab order.
- Text must meet WCAG AA contrast on both light and dark surfaces.
- Do not rely on hover-only inspection for critical log details.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05-25 | Initial design system created | Created by design consultation for a Codex log visualization dashboard. Research showed trace tools converge on observability tables and spans; CC Flight should differentiate with a map-first agent flight recorder. |
| 2026-05-25 | Added evidence-backed game mechanics | Borrowed quests, badges, progression, and learning paths from Habitica, Exercism, freeCodeCamp, and Moodle badges while keeping CC Flight serious and trace-driven. |
| 2026-05-25 | Reframed CC Flight as developer platformer plus factory | User clarified they want the product to lean toward familiar games like Mario, not generic gamification. The accepted direction is side-scrolling platformer as primary metaphor with a small automation/factory layer for workflow causality. |
| 2026-05-25 | Relaxed prototype IP boundary | User stated IP safety does not need to constrain this prototype. The design can use Mario-like placeholder language and visuals for now. |
| 2026-05-25 | Selected replay-driven animation | User chose Variant C over ambient motion. Motion should be tied to session replay: the agent sprite moves through events and the factory belt advances with the timeline. |
| 2026-05-25 | Promoted project timeline to foundation | User clarified the target is complex engineering: generate a from-start-to-now timeline of the full development process as the base view. Agent Run remains a drill-down interaction. |
| 2026-05-25 | Adopted command-center visual reference | User provided Evreghen Command Center design tokens. CC Flight should use warm off-white workspace, dark frosted shell, compact system typography, and orange telemetry accents while retaining timeline-first IA and replay drill-downs. |
