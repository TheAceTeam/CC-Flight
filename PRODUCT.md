# Product

## Register

product

## Users

Developers and engineering teams who run coding agents — Codex CLI, Claude Code, and OpenCode — and want to understand what those agents actually did. They open CC Flight after (or between) agent sessions to debug a confusing run, account for token spend and cost, audit context-window behavior, and see hidden work that a raw transcript buries: tool calls, context snapshots, errors, and project telemetry.

Their context is local and private: CC Flight runs on their own machine against logs that never leave it. The job to be done is **"make a coding-agent session legible"** — turn an opaque pile of JSONL into a navigable, replayable trace map they can reason about at a glance.

## Product Purpose

CC Flight is a local-first **flight recorder for coding agents**. It ingests session logs from multiple providers, reconstructs every task journey, and surfaces the run's anatomy in one dashboard: Session Recap (cost, tokens, tool calls, errors, model usage, rhythm), Context Replay (snapshot-by-snapshot walkthrough of the agent's context window), Token Timeline, Share Cards, and per-event Evidence with redacted provenance.

It exists because the LLM-observability category is converging on the same visually predictable surface — trace trees, span tables, cost charts, provider metric grids — that treats an agent session as a transcript to inspect rather than an object to navigate. CC Flight's bet is that a coding session has geography, causality, and momentum, and that showing it that way produces the memorable reaction: *"I have never seen a coding agent from this angle."*

Success is a developer opening a session they didn't understand and leaving with a clear mental model of how the agent got from task to verified finish — where it stalled, what it cost, and where risk still lives.

> **Note on the game layer:** Earlier concept work (see `DESIGN.md`) explored a Mario-like "Agent Run" platformer replay as the headline view. The product's true north today is the **flight-recorder dashboard**; the platformer concept is shelved/aspirational. Treat the dashboard as the product when making design decisions, and disregard platformer-first framing unless the owner revives it explicitly.

## Brand Personality

Focused, technical, premium — a serious engineering operations interface with a "Warm Engineering Command Center" feel: warm off-white workspace, dark frosted shell, compact system typography, restrained cards, concentrated orange telemetry accents.

Three words: **operational, precise, quietly confident.** The tone is the calm authority of a control room, not the excitement of a marketing page. Any playfulness is earned and restrained — it shows up as a clever detail at drill-down moments, never as decoration competing with the data.

## Anti-references

- **Generic trace-tree observability dashboards** (LangSmith / Langfuse / Braintrust style): span trees, raw tables, and provider metric grids. CC Flight keeps the fundamentals but must not wear the category's predictable face.
- **Toy / childish gamification:** a real dashboard with cartoon stickers, badge spam, confetti, or toy mascots. If a game metaphor appears, it must read as a clever developer instrument, not a Mario clone with toy stickers.
- **Cluttered enterprise APM** (Datadog / Grafana wall-of-widgets): density that overwhelms instead of focusing attention. CC Flight prioritizes legibility and a single clear reading path over maximal widget count.
- **Cloud SaaS marketing UI:** hero-metric templates, gradient accents, identical card grids, sign-up funnels. CC Flight is local-first with no accounts.

## Design Principles

- **Make complex work legible first.** The primary job is turning opaque agent logs into something a developer can read at a glance. Clarity beats cleverness when they conflict.
- **A session is an object, not a transcript.** Favor representations with geography, causality, and momentum (timelines, replays, factory strips) over flat lists and raw dumps.
- **Earned playfulness, never toy.** A surprising or game-like detail is welcome only when it sharpens understanding; it must feel like an instrument for serious engineers.
- **Evidence over assertion.** Surface concrete, redacted proof with provenance (path, line, timestamp, hash) — enough to debug, never raw dumps. Trust comes from showing the receipts.
- **Built for long sessions.** Neutral-heavy, low-fatigue, dense-but-scannable. Optimize for someone reading this for an hour, not for a screenshot.

## Accessibility & Inclusion

No formal WCAG conformance target is mandated (personal/developer tool, local-first). Apply general good practice consistent with the command-center direction: maintain readable contrast for long sessions, keep tabular data legible with tabular-nums, and prefer accommodating reduced-motion users where animation is prominent (auto-play replay, gauges, heatmaps). Raise the bar to a formal target only if the owner requests it.
