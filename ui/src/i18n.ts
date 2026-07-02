import type { InsightSignalKind } from "./insights";

export type Language = "en" | "zh-CN";
export type TokenChartCopy = {
  defaultTitle: string;
  eyebrow: string;
  loading: string;
  visibleDays: (count: number) => string;
  noVisibleDays: string;
  summaryAria: string;
  totalTokens: string;
  kvHit: string;
  hideChart: string;
  showChart: string;
  breakdownAria: string;
  chartAria: string;
  chartTitle: string;
  totalSuffix: string;
  trendLabel: string;
  tokenSuffix: string;
  input: string;
  cachedInput: string;
  output: string;
  reasoning: string;
  totalTrend: string;
  legendAria: string;
  emptyLoading: string;
  empty: string;
};

export type IngestCopy = {
  kicker: string;
  completed: string;
  failed: string;
  running: string;
  files: string;
  phase: string;
  current: string;
  waitingFile: string;
  coins: string;
  clearedBlocks: string;
  hazards: string;
  events: string;
  aria: (status: string, phase: string, processed: number, total: number, percent: number) => string;
};

export type TourCopy = {
  restart: string;
  skip: string;
  next: string;
  prev: string;
  done: string;
  stepLabel: (current: number, total: number) => string;
  steps: Array<{ title: string; detail: string }>;
};

export type AppCopy = {
  brandSubtitle: string;
  language: { short: string; aria: string; title: string };
  theme: {
    aria: string;
    names: {
      light: string;
      dark: string;
      forest: string;
      plasma: string;
      morandi: string;
    };
  };
  topbar: {
    agentLogRoot: string;
    agentLogRootAria: string;
    agentLogRootPlaceholder: string;
    autoUpdate: string;
    autoUpdateOff: string;
    autoUpdateOn: string;
    source: string;
    sourceAria: string;
    scan: string;
  };
  title: { eyebrow: string; emptyProject: string; lead: string; share: string; shareCopied: string; shareCardTitle: string; shareCopy: string; shareCopyMarkdown: string; shareDownloadPng: string; shareClose: string; sharePngSaved: string; shareUsageByDay: string };
  projectControls: { provider: string; providerAria: string; project: string; projectAria: string; all: string; noProvider: string; search: string; noSearchResults: string };
  metrics: { projects: string; events: string; tasks: string; tokens: string; kvHit: string; cost: string; showDailyTokens: string; hideDailyTokens: string; dailyUsageByDay: string };
  empty: {
    loadingTitle: string;
    loadingDetail: string;
    noRunsTitle: string;
    noRunsDetail: string;
    noProviderTitle: string;
    noProviderDetail: string;
    source: string;
    sourceAria: string;
    root: string;
    rootAria: string;
  };
  loading: { scanningLogs: string; loadingTimeline: string; loadingIndex: string; loadingDailyTokens: string; steady: string; aria: string };
  timeline: {
    heading: string;
    rangeOf: string;
    loaded: (tasks: number, events: number) => string;
    prevPage: string;
    nextPage: string;
    emptyPage: string;
    aria: string;
    masterAria: string;
    detailsAria: string;
    masterTitle: string;
    detailsTitle: string;
    statusLegendAria: string;
    statusLegendRunning: string;
    statusLegendSuccess: string;
    statusLegendFailed: string;
    detailTabsAria: string;
    insightBoardAria: string;
    insightBoardTitle: string;
    insightBoardEmpty: string;
    insightBoardClose: string;
    insightBoardMaximize: string;
    insightScore: string;
    insightTools: string;
    insightFiles: string;
    insightSignals: Record<InsightSignalKind, string>;
    insightReasonMissingVerification: string;
    insightReasonFailedRun: string;
    insightReasonToolLoop: (count: number) => string;
    insightReasonHighCost: (tokens: string) => string;
    insightReasonFileBlast: (count: number) => string;
    insightReasonErrorPressure: (count: number) => string;
    insightReasonContextChurn: (count: number) => string;
    conversationTab: string;
    contextReplayTab: string;
    contextReplayLedgerAria: string;
    contextReplayLoading: string;
    contextReplayEmpty: string;
    contextReplayObserved: string;
    contextReplayBlocks: string;
    contextReplaySkills: string;
    contextReplaySnapshotRail: string;
    contextReplayWarnings: string;
    contextReplayNoWarnings: string;
    contextReplayWarningJump: string;
    contextReplayActiveContext: string;
    contextReplayAdded: string;
    contextReplayChanged: string;
    contextReplayDropped: string;
    contextReplayLaneActive: string;
    contextReplayLaneRetired: string;
    contextReplayLaneWarnings: string;
    contextReplayMiniSceneAria: string;
    contextReplaySource: string;
    contextReplayReason: string;
    contextReplayTokens: string;
    contextReplayInput: string;
    contextReplayOutput: string;
    contextReplayTokenUsage: string;
    contextReplayStep: string;
    contextReplayFromStep: (step: number) => string;
    contextReplayAutoReplay: string;
    contextReplayAutoStop: string;
    contextReplayInspector: string;
    contextReplaySelectedBlock: string;
    contextReplayEvent: string;
    contextReplayConfidence: string;
    contextReplayNoSelection: string;
    emptySelection: string;
    nextInput: string;
    sessionEnd: string;
    eventCount: (count: number) => string;
    loadingDetails: string;
    tokens: string;
    kvHit: string;
    agentWork: string;
    viewProcess: string;
    hideProcess: string;
    backgroundWork: string;
    log: string;
    entries: string;
    noBackground: string;
    noLog: string;
    user: string;
    expand: string;
    collapse: string;
    skills: string;
    spineThought: string;
    spineAction: string;
    spineObserved: string;
    spineResponse: string;
    spineRedacted: string;
    spineCourseCorrected: string;
    spineMoves: string;
    spineToolCalls: string;
    spineCorrections: string;
    spinePlay: string;
    spinePause: string;
    spineReplay: string;
    spineStepPrev: string;
    spineStepNext: string;
    spineScrubAria: string;
    spineAria: string;
    spineRedirectedRun: string;
    hotkeyHint: string;
    resetDatabase: string;
    resetDatabaseConfirm: string;
    share: string;
    shareCopied: string;
    shareCardTitle: string;
    shareClose: string;
    shareCopy: string;
    shareCopyMarkdown: string;
    shareProject: string;
    shareProvider: string;
    shareSteps: string;
    shareTokenUsage: string;
    shareInput: string;
    shareOutput: string;
    shareTotal: string;
    shareContextBlocks: string;
    shareActive: string;
    shareRetired: string;
    shareSnapshotOf: (n: number, total: number) => string;
    shareTimestamp: string;
    shareHeroCacheHit: (pct: string) => string;
    shareHeroBigTokens: (tokens: string) => string;
    shareHeroLongRun: (duration: string) => string;
    shareHeroRiskSignals: (n: number) => string;
    shareHeroFailedStep: (step: number) => string;
    shareHeroStepReplay: (steps: number) => string;
    shareCaptionCacheHit: (cached: string, steps: number) => string;
    shareCaptionBigTokens: (steps: number) => string;
    shareCaptionLongRun: (steps: number) => string;
    shareCaptionRiskSignals: string;
    shareCaptionFailed: string;
    shareCaptionStepReplay: (duration: string) => string;
    shareStoryTemplate: (provider: string, steps: number, title: string) => string;
    shareSkillsUsed: (names: string) => string;
    shareVerdictCleared: string;
    shareVerdictFailed: string;
    shareVerdictRunning: string;
    shareVerdictNoteCleared: string;
    shareVerdictNoteFailed: (title: string) => string;
    shareVerdictNoteRunning: string;
    shareVerdictRisks: (n: number) => string;
    shareTimelineAria: string;
    shareStatsCompact: (tokens: string, duration: string, kv: string) => string;
    shareProviderUnknown: string;
    readoutSessions: string;
    readoutEstCost: string;
    readoutTotalTokens: string;
    readoutToolCalls: string;
    readoutErrors: string;
    pricingHeading: string;
    pricingNote: string;
    pricingInputRate: string;
    pricingOutputRate: string;
    toolUsageHeading: string;
    toolUsageErrors: string;
    toolUsageEmpty: string;
    searchPlaceholder: string;
    sortLabel: string;
    sortNewest: string;
    sortCost: string;
    sortDuration: string;
    sortTools: string;
    sortErrors: string;
    dropzoneHint: string;
    dropzoneActive: string;
    modelSpendHeading: string;
    modelSpendEmpty: string;
    modelSpendModel: string;
    modelSpendMsgs: string;
    modelSpendInput: string;
    modelSpendOutput: string;
    modelSpendCached: string;
    modelSpendCost: string;
    modelSpendTotal: string;
    recapToggle: string;
    recapRhythmHeading: string;
    recapDailyActivity: string;
    recapWhenYouShip: string;
    recapEfficiencyHeading: string;
    recapCacheHit: string;
    recapErrorRate: string;
    recapTokensPerSession: string;
    recapCostPerSession: string;
    recapEmpty: string;
  };
  evidence: {
    heading: string;
    loading: string;
    kind: string;
    time: string;
    tool: string;
    call: string;
    noDetail: string;
    artifacts: string;
    inlineEvidence: string;
    noArtifacts: string;
    rawEvent: string;
    noRawEvent: string;
    empty: string;
  };
  ingest: IngestCopy;
  tokenChart: TokenChartCopy;
  tour: TourCopy;
};

export function normalizeLanguage(value: string | null): Language {
  return value === "zh-CN" ? "zh-CN" : "en";
}

export const COPY: Record<Language, AppCopy> = {
  en: {
    brandSubtitle: "The flight recorder of your coding agents",
    language: {
      short: "中",
      aria: "Switch language to Simplified Chinese",
      title: "Switch language to Simplified Chinese"
    },
    theme: {
      aria: "Toggle theme",
      names: {
        light: "Bright Command Center",
        dark: "Dark Command Center",
        forest: "Forest Lab",
        plasma: "Plasma Violet",
        morandi: "Morandi Dusk"
      }
    },
    topbar: {
      agentLogRoot: "Agent log root",
      agentLogRootAria: "Agent log root path",
      agentLogRootPlaceholder: "Blank scans default Codex logs",
      autoUpdate: "Auto",
      autoUpdateOff: "Auto update off",
      autoUpdateOn: "Auto update on",
      source: "Source",
      sourceAria: "Agent log source",
      scan: "Scan Agent Logs"
    },
    title: {
      eyebrow: "Project Flight Recorder",
      emptyProject: "No project indexed yet",
      lead: "",
      share: "Share",
      shareCopied: "Summary copied to clipboard",
      shareCardTitle: "Project recap",
      shareCopy: "Copy",
      shareCopyMarkdown: "Copy as Markdown",
      shareDownloadPng: "Download PNG",
      shareClose: "Close",
      sharePngSaved: "Image saved",
      shareUsageByDay: "Usage by day"
    },
    projectControls: {
      provider: "Provider",
      providerAria: "Project provider",
      project: "Project",
      projectAria: "Project",
      all: "All",
      noProvider: "No provider",
      search: "Search projects",
      noSearchResults: "No matching projects"
    },
    metrics: {
      projects: "Projects",
      events: "Events",
      tasks: "Tasks",
      tokens: "Tokens",
      kvHit: "KV hit",
      cost: "Est. cost",
      showDailyTokens: "Show daily token usage chart",
      hideDailyTokens: "Hide daily token usage chart",
      dailyUsageByDay: "Daily usage by day"
    },
    empty: {
      loadingTitle: "Loading SuperView index",
      loadingDetail: "Checking local SQLite state.",
      noRunsTitle: "No agent runs indexed",
      noRunsDetail: "Scan local Codex, Claude Code, or OpenCode logs to build the first timeline.",
      noProviderTitle: "No projects for this provider",
      noProviderDetail: "Switch the project filter to All, or scan logs for the selected provider.",
      source: "Agent log source",
      sourceAria: "Empty agent log source",
      root: "Agent log root path",
      rootAria: "Empty agent log root path"
    },
    loading: {
      scanningLogs: "Scanning agent logs",
      loadingTimeline: "Loading timeline page",
      loadingIndex: "Loading SuperView index",
      loadingDailyTokens: "Loading daily token usage",
      steady: "Keeping the workspace steady while SuperView updates.",
      aria: "Blocking operation"
    },
    timeline: {
      heading: "CLI Conversation",
      rangeOf: "of",
      loaded: (tasks: number, events: number) => `${tasks} task journeys loaded from ${events} events`,
      prevPage: "Prev page",
      nextPage: "Next page",
      emptyPage: "No user-input task journeys are visible on this page.",
      aria: "Task conversation thread",
      masterAria: "User input index",
      detailsAria: "Conversation details",
      masterTitle: "User inputs",
      detailsTitle: "Conversation details",
      statusLegendAria: "Run status legend",
      statusLegendRunning: "Running",
      statusLegendSuccess: "Success",
      statusLegendFailed: "Failed",
      detailTabsAria: "Thread detail tabs",
      insightBoardAria: "Sessions needing attention",
      insightBoardTitle: "Attention Board",
      insightBoardEmpty: "No red or yellow sessions detected.",
      insightBoardClose: "Close insight board",
      insightBoardMaximize: "Maximize insight board",
      insightScore: "health",
      insightTools: "tools",
      insightFiles: "files",
      insightSignals: {
        missing_verification: "Patch lacks verification",
        failed_run: "Failed run",
        tool_loop: "Tool loop pressure",
        high_cost: "High token burn",
        file_blast: "Wide file impact",
        error_pressure: "Error pressure",
        context_churn: "Context churn",
      },
      insightReasonMissingVerification: "no verification after patch",
      insightReasonFailedRun: "run ended failed",
      insightReasonToolLoop: (count: number) => `${count} repeated tool calls`,
      insightReasonHighCost: (tokens: string) => `${tokens} tokens`,
      insightReasonFileBlast: (count: number) => `${count} files touched`,
      insightReasonErrorPressure: (count: number) => `${count} error signals`,
      insightReasonContextChurn: (count: number) => `${count} context events`,
      conversationTab: "Conversation",
      contextReplayTab: "Context Replay",
      contextReplayLedgerAria: "Context Replay ledger",
      contextReplayLoading: "Loading observable context...",
      contextReplayEmpty: "Open this task after details are indexed to inspect observable context.",
      contextReplayObserved: "Observable log evidence only: prompt, tool I/O, file references, verification, warnings, and final response.",
      contextReplayBlocks: "blocks",
      contextReplaySkills: "skills",
      contextReplaySnapshotRail: "Context snapshot rail",
      contextReplayWarnings: "Context warnings",
      contextReplayNoWarnings: "No warnings for this snapshot",
      contextReplayWarningJump: "Jump to the related context block",
      contextReplayActiveContext: "Carried forward context",
      contextReplayAdded: "Newly added",
      contextReplayChanged: "Changed or contradicted",
      contextReplayDropped: "Dropped or stale",
      contextReplayLaneActive: "Carried forward context",
      contextReplayLaneRetired: "Retired blocks",
      contextReplayLaneWarnings: "Warning signals",
      contextReplayMiniSceneAria: "Context flow swim lanes",
      contextReplaySource: "Source",
      contextReplayReason: "Why",
      contextReplayTokens: "Est. tokens",
      contextReplayInput: "Input",
      contextReplayOutput: "Output",
      contextReplayTokenUsage: "Tokens",
      contextReplayStep: "Step",
      contextReplayFromStep: (step) => `from step ${step}`,
      contextReplayAutoReplay: "Auto replay",
      contextReplayAutoStop: "Stop",
      contextReplayInspector: "Context evidence",
      contextReplaySelectedBlock: "Selected block",
      contextReplayEvent: "Event",
      contextReplayConfidence: "Confidence",
      contextReplayNoSelection: "Select a context block to inspect its source, state, and reason.",
      emptySelection: "Select a user input",
      nextInput: "Next input",
      sessionEnd: "Session end",
      eventCount: (count: number) => `${count} events`,
      loadingDetails: "Loading details",
      tokens: "tokens",
      kvHit: "KV hit",
      agentWork: "Agent work",
      viewProcess: "View process...",
      hideProcess: "Hide process...",
      backgroundWork: "Background Work",
      log: "Log",
      entries: "entries",
      noBackground: "No background work captured for this task.",
      noLog: "No tool or verification log entries captured.",
      user: "User",
      expand: "Expand",
      collapse: "Collapse",
      skills: "Skills",
      spineThought: "Thought",
      spineAction: "Action",
      spineObserved: "Observed",
      spineResponse: "Response",
      spineRedacted: "private reasoning · redacted",
      spineCourseCorrected: "course-corrected the next thought",
      spineMoves: "moves",
      spineToolCalls: "tool calls",
      spineCorrections: "course-corrections",
      spinePlay: "Play",
      spinePause: "Pause",
      spineReplay: "Replay",
      spineStepPrev: "Previous move",
      spineStepNext: "Next move",
      spineScrubAria: "Scrub run",
      spineAria: "Reasoning causal spine",
      spineRedirectedRun: "redirected mid-run",
      hotkeyHint: "↑↓ switch journey · ←→ switch step · W S A D switch block",
      resetDatabase: "Reset database",
      resetDatabaseConfirm: "This will permanently delete all indexed data. Scan again to rebuild. Continue?",
      share: "Share",
      shareCopied: "Copied to clipboard!",
      shareCardTitle: "Context Replay Summary",
      shareClose: "Close",
      shareCopy: "Copy summary",
      shareCopyMarkdown: "Copy as Markdown",
      shareProject: "Project",
      shareProvider: "Provider",
      shareSteps: "Steps",
      shareTokenUsage: "Token usage",
      shareInput: "Input",
      shareOutput: "Output",
      shareTotal: "Total",
      shareContextBlocks: "Context blocks",
      shareActive: "Active",
      shareRetired: "Retired",
      shareSnapshotOf: (n: number, total: number) => `Snapshot ${n} / ${total}`,
      shareTimestamp: "Shared at",
      shareHeroCacheHit: (pct: string) => `${pct} cache hit`,
      shareHeroBigTokens: (tokens: string) => `${tokens} tokens`,
      shareHeroLongRun: (duration: string) => `${duration} on one task`,
      shareHeroRiskSignals: (n: number) => `${n} risk signal${n === 1 ? "" : "s"}`,
      shareHeroFailedStep: (step: number) => `Failed at step ${step}`,
      shareHeroStepReplay: (steps: number) => `${steps} step replay`,
      shareCaptionCacheHit: (cached: string, steps: number) => `Agent reused ${cached} cached tokens across ${steps} steps.`,
      shareCaptionBigTokens: (steps: number) => `Spent across ${steps} reasoning steps.`,
      shareCaptionLongRun: (steps: number) => `${steps} steps of agent work in one task journey.`,
      shareCaptionRiskSignals: "Anomalies detected in the agent's reasoning chain.",
      shareCaptionFailed: "Agent could not reach a verified finish.",
      shareCaptionStepReplay: (duration: string) => `A traceable agent journey, ${duration} end to end.`,
      shareStoryTemplate: (provider: string, steps: number, title: string) => `${provider} ran ${steps} steps to ${title}`,
      shareSkillsUsed: (names: string) => `Skills used: ${names}`,
      shareVerdictCleared: "Cleared",
      shareVerdictFailed: "Failed",
      shareVerdictRunning: "In progress",
      shareVerdictNoteCleared: "Reached final response with proof.",
      shareVerdictNoteFailed: (title: string) => `Stopped at ${title}`,
      shareVerdictNoteRunning: "Agent still running this task.",
      shareVerdictRisks: (n: number) => `${n} risk signal${n === 1 ? "" : "s"} along the way`,
      shareTimelineAria: "Snapshot timeline by phase",
      shareStatsCompact: (tokens: string, duration: string, kv: string) => `${tokens} · ${duration} · KV ${kv}`,
      shareProviderUnknown: "Coding agent",
      readoutSessions: "Sessions",
      readoutEstCost: "Est. Cost",
      readoutTotalTokens: "Total Tokens",
      readoutToolCalls: "Tool Calls",
      readoutErrors: "Errors",
      pricingHeading: "Token Rates & Cost Assumptions",
      pricingNote: "Standard API rates, USD per 1M tokens. Anthropic: input + output + cached reads (×0.1) + cache writes (×1.25). Edit any field to recompute costs.",
      pricingInputRate: "Input $/M",
      pricingOutputRate: "Output $/M",
      toolUsageHeading: "Tool Usage",
      toolUsageErrors: "errors",
      toolUsageEmpty: "No tool calls recorded for this user input.",
      searchPlaceholder: "Search by title...",
      sortLabel: "Sort",
      sortNewest: "Newest first",
      sortCost: "Highest cost",
      sortDuration: "Longest duration",
      sortTools: "Most tools",
      sortErrors: "Most errors",
      dropzoneHint: "Drop JSONL files here",
      dropzoneActive: "Drop to import",
      modelSpendHeading: "Spend by Model",
      modelSpendEmpty: "No model usage data available.",
      modelSpendModel: "Model",
      modelSpendMsgs: "Msgs",
      modelSpendInput: "Input",
      modelSpendOutput: "Output",
      modelSpendCached: "Cached",
      modelSpendCost: "Cost",
      modelSpendTotal: "Total",
      recapToggle: "Session Recap",
      recapRhythmHeading: "Rhythm",
      recapDailyActivity: "daily activity",
      recapWhenYouShip: "when you ship",
      recapEfficiencyHeading: "Efficiency",
      recapCacheHit: "Cache Hit Rate",
      recapErrorRate: "Error Rate",
      recapTokensPerSession: "Tokens / Session",
      recapCostPerSession: "Cost / Session",
      recapEmpty: "No session data to recap."
    },
    evidence: {
      heading: "Evidence",
      loading: "Loading",
      kind: "Kind",
      time: "Time",
      tool: "Tool",
      call: "Call",
      noDetail: "No detail captured.",
      artifacts: "Artifacts",
      inlineEvidence: "Inline evidence",
      noArtifacts: "No artifacts attached to this event.",
      rawEvent: "Raw Event",
      noRawEvent: "No raw event reference available.",
      empty: "Select an episode, timeline event, or replay node to inspect redacted evidence."
    },
    ingest: {
      kicker: "Ingest level",
      completed: "Castle clear",
      failed: "Level failed",
      running: "Running level",
      files: "files",
      phase: "Phase",
      current: "Current",
      waitingFile: "Waiting for next file",
      coins: "Coins",
      clearedBlocks: "Cleared blocks",
      hazards: "Hazards",
      events: "Events",
      aria: (status: string, phase: string, processed: number, total: number, percent: number) => `Ingest ${status}, ${phase}, ${processed} of ${total} files processed, ${percent} percent`
    },
    tokenChart: {
      defaultTitle: "Daily Token Usage",
      eyebrow: "Tokens",
      loading: "Loading daily usage",
      visibleDays: (count: number) => `${count} visible day${count === 1 ? "" : "s"}`,
      noVisibleDays: "No visible days",
      summaryAria: "Daily token usage summary",
      totalTokens: "Total tokens",
      kvHit: "KV hit",
      hideChart: "Hide daily token usage chart",
      showChart: "Show daily token usage chart",
      breakdownAria: "Visible token usage breakdown",
      chartAria: "Daily token usage chart",
      chartTitle: "Daily token usage by date",
      totalSuffix: "total tokens",
      trendLabel: "trend",
      tokenSuffix: "tokens",
      input: "Input",
      cachedInput: "Cached input",
      output: "Output",
      reasoning: "Reasoning",
      totalTrend: "Total trend",
      legendAria: "Token usage legend",
      emptyLoading: "Loading daily token usage...",
      empty: "No daily token usage yet."
    },
    tour: {
      restart: "Restart tour",
      skip: "Skip tour",
      next: "Next",
      prev: "Back",
      done: "Done",
      stepLabel: (current: number, total: number) => `Step ${current} of ${total}`,
      steps: [
        {
          title: "Scan Agent Logs",
          detail: "Point SuperView at your Codex, Claude Code, or OpenCode log directory to begin indexing agent runs."
        },
        {
          title: "Switch Projects",
          detail: "Browse all indexed projects. Filter by provider and select a project to inspect its timeline."
        },
        {
          title: "Session Recap",
          detail: "A collapsible analytics dashboard: sessions, tokens, cost, daily activity calendar, when-you-ship heatmap, efficiency gauges, tool usage, and spend by model."
        },
        {
          title: "Daily Token Usage",
          detail: "Horizon chart showing daily token consumption in compact layered bands — cached input, input, output, and reasoning tokens — stacked side by side with the rhythm panels."
        },
        {
          title: "User Input",
          detail: "Every user message spawns a task journey. Click any journey to expand its tool calls, evidence, and context replay."
        },
        {
          title: "Context Replay",
          detail: "Step through the agent's context window snapshot-by-snapshot. Watch context blocks added, modified, and dropped over time."
        },
        {
          title: "Context Replay Summary",
          detail: "A quick readout of the current context replay session: total snapshots, block counts, hazards, and event counts."
        },
        {
          title: "Context Timeline",
          detail: "A full-width factory belt view of every snapshot and its active context blocks. See the entire context flow at a glance."
        },
        {
          title: "Token Timeline",
          detail: "Click the chart button in the conversation header to open the token timeline panel. See how token usage evolved across all steps."
        },
        {
          title: "Theme & Language",
          detail: "Switch between 5 themes (light, dark, forest, plasma, Morandi), toggle English / 中文, or click the Map button in the topbar to restart this tour anytime."
        }
      ]
    }
  },
  "zh-CN": {
    brandSubtitle: "Coding Agent 飞行记录仪",
    language: {
      short: "EN",
      aria: "切换语言到英文",
      title: "切换语言到英文"
    },
    theme: {
      aria: "切换主题",
      names: {
        light: "明亮指挥中心",
        dark: "暗色指挥中心",
        forest: "森林实验室",
        plasma: "等离子紫",
        morandi: "莫兰迪黄昏"
      }
    },
    topbar: {
      agentLogRoot: "Agent 日志根目录",
      agentLogRootAria: "Agent 日志根目录路径",
      agentLogRootPlaceholder: "留空则扫描默认 Codex 日志",
      autoUpdate: "自动",
      autoUpdateOff: "自动更新已关闭",
      autoUpdateOn: "自动更新已开启",
      source: "来源",
      sourceAria: "Agent 日志来源",
      scan: "扫描 Agent 日志"
    },
    title: {
      eyebrow: "Project Flight Recorder",
      emptyProject: "还没有索引项目",
      lead: "",
      share: "分享",
      shareCopied: "摘要已复制到剪贴板",
      shareCardTitle: "项目概览",
      shareCopy: "复制",
      shareCopyMarkdown: "复制为 Markdown",
      shareDownloadPng: "下载图片",
      shareClose: "关闭",
      sharePngSaved: "图片已保存",
      shareUsageByDay: "按天用量"
    },
    projectControls: {
      provider: "来源",
      providerAria: "项目来源",
      project: "项目",
      projectAria: "项目",
      all: "全部",
      noProvider: "无来源",
      search: "搜索项目",
      noSearchResults: "没有匹配项目"
    },
    metrics: {
      projects: "项目",
      events: "事件",
      tasks: "任务",
      tokens: "Tokens",
      kvHit: "KV 命中",
      cost: "估算费用",
      showDailyTokens: "显示按天 token 用量图",
      hideDailyTokens: "隐藏按天 token 用量图",
      dailyUsageByDay: "按天用量"
    },
    empty: {
      loadingTitle: "正在加载 SuperView 索引",
      loadingDetail: "正在检查本地 SQLite 状态。",
      noRunsTitle: "还没有索引 Agent Runs",
      noRunsDetail: "扫描本地 Codex、Claude Code 或 OpenCode 日志，生成第一条时间线。",
      noProviderTitle: "这个来源下还没有项目",
      noProviderDetail: "把项目过滤切到全部，或者扫描当前来源的日志。",
      source: "Agent 日志来源",
      sourceAria: "空状态 Agent 日志来源",
      root: "Agent 日志根目录路径",
      rootAria: "空状态 Agent 日志根目录路径"
    },
    loading: {
      scanningLogs: "正在扫描 agent 日志",
      loadingTimeline: "正在加载时间线分页",
      loadingIndex: "正在加载 SuperView 索引",
      loadingDailyTokens: "正在加载按天 token 用量",
      steady: "SuperView 更新中，暂时锁定工作区。",
      aria: "阻塞操作"
    },
    timeline: {
      heading: "CLI 对话",
      rangeOf: "/",
      loaded: (tasks: number, events: number) => `已从 ${events} 个事件加载 ${tasks} 轮任务旅程`,
      prevPage: "上一页",
      nextPage: "下一页",
      emptyPage: "当前页没有可见的用户输入任务旅程。",
      aria: "任务对话 thread",
      masterAria: "用户输入索引",
      detailsAria: "对话详情",
      masterTitle: "用户输入",
      detailsTitle: "对话详情",
      statusLegendAria: "运行状态图例",
      statusLegendRunning: "进行中",
      statusLegendSuccess: "成功",
      statusLegendFailed: "失败",
      detailTabsAria: "Thread 详情标签",
      insightBoardAria: "需要关注的 Session",
      insightBoardTitle: "关注面板",
      insightBoardEmpty: "未检测到红色或黄色 Session。",
      insightBoardClose: "关闭关注面板",
      insightBoardMaximize: "最大化关注面板",
      insightScore: "健康分",
      insightTools: "工具",
      insightFiles: "文件",
      insightSignals: {
        missing_verification: "代码变更缺少验证",
        failed_run: "运行失败",
        tool_loop: "工具循环压力",
        high_cost: "Token 消耗偏高",
        file_blast: "文件影响面较广",
        error_pressure: "错误压力",
        context_churn: "上下文 churn",
      },
      insightReasonMissingVerification: "patch 后没有验证",
      insightReasonFailedRun: "运行以失败结束",
      insightReasonToolLoop: (count: number) => `${count} 次重复工具调用`,
      insightReasonHighCost: (tokens: string) => `${tokens} tokens`,
      insightReasonFileBlast: (count: number) => `影响 ${count} 个文件`,
      insightReasonErrorPressure: (count: number) => `${count} 条错误信号`,
      insightReasonContextChurn: (count: number) => `${count} 个上下文事件`,
      conversationTab: "Conversation",
      contextReplayTab: "Context Replay",
      contextReplayLedgerAria: "Context Replay ledger",
      contextReplayLoading: "正在加载可观察上下文...",
      contextReplayEmpty: "打开这轮任务后，可查看日志中可观察到的上下文。",
      contextReplayObserved: "仅展示日志中可观察证据：prompt、tool I/O、文件引用、验证、warning 和最终回复。",
      contextReplayBlocks: "blocks",
      contextReplaySkills: "skills",
      contextReplaySnapshotRail: "Context snapshot rail",
      contextReplayWarnings: "Context warnings",
      contextReplayNoWarnings: "这个快照没有 warning",
      contextReplayWarningJump: "跳转到相关上下文块",
      contextReplayActiveContext: "Carried forward context",
      contextReplayAdded: "新增上下文",
      contextReplayChanged: "变化或冲突",
      contextReplayDropped: "丢失或过期",
      contextReplayLaneActive: "延续上下文",
      contextReplayLaneRetired: "已退出",
      contextReplayLaneWarnings: "风险信号",
      contextReplayMiniSceneAria: "上下文流泳道",
      contextReplaySource: "来源",
      contextReplayReason: "原因",
      contextReplayTokens: "估算 tokens",
      contextReplayInput: "输入",
      contextReplayOutput: "输出",
      contextReplayTokenUsage: "Token 用量",
      contextReplayStep: "Step",
      contextReplayFromStep: (step) => `来自步骤 ${step}`,
      contextReplayAutoReplay: "自动回放",
      contextReplayAutoStop: "停止",
      contextReplayInspector: "上下文证据",
      contextReplaySelectedBlock: "选中 block",
      contextReplayEvent: "事件",
      contextReplayConfidence: "置信度",
      contextReplayNoSelection: "选择一个 context block，查看来源、状态和保留原因。",
      emptySelection: "选择一条用户输入",
      nextInput: "下一次输入",
      sessionEnd: "Session 结束",
      eventCount: (count: number) => `${count} 个事件`,
      loadingDetails: "正在加载细节",
      tokens: "tokens",
      kvHit: "KV 命中",
      agentWork: "Agent 工作过程",
      viewProcess: "查看过程...",
      hideProcess: "收起过程...",
      backgroundWork: "后台工作",
      log: "日志",
      entries: "条",
      noBackground: "这轮任务没有捕获到后台工作过程。",
      noLog: "没有捕获到 tool 或 verification 日志。",
      user: "用户",
      expand: "展开",
      collapse: "收起",
      skills: "Skills",
      spineThought: "想法",
      spineAction: "动作",
      spineObserved: "观察",
      spineResponse: "回复",
      spineRedacted: "私有推理 · 已隐去",
      spineCourseCorrected: "修正了下一步想法",
      spineMoves: "回合",
      spineToolCalls: "工具调用",
      spineCorrections: "中途修正",
      spinePlay: "播放",
      spinePause: "暂停",
      spineReplay: "重播",
      spineStepPrev: "上一回合",
      spineStepNext: "下一回合",
      spineScrubAria: "拖动进度",
      spineAria: "推理因果链",
      spineRedirectedRun: "中途修正",
      hotkeyHint: "↑↓ 切换对话 · ←→ 切换步骤 · W S A D 切换上下文块",
      resetDatabase: "重置数据库",
      resetDatabaseConfirm: "此操作将永久删除所有已索引数据。重新扫描后可重建。继续？",
      share: "分享",
      shareCopied: "已复制到剪贴板！",
      shareCardTitle: "Context Replay 摘要",
      shareClose: "关闭",
      shareCopy: "复制摘要",
      shareCopyMarkdown: "复制为 Markdown",
      shareProject: "项目",
      shareProvider: "来源",
      shareSteps: "步骤",
      shareTokenUsage: "Token 用量",
      shareInput: "输入",
      shareOutput: "输出",
      shareTotal: "总计",
      shareContextBlocks: "Context Block",
      shareActive: "活跃",
      shareRetired: "已退出",
      shareSnapshotOf: (n: number, total: number) => `快照 ${n} / ${total}`,
      shareTimestamp: "分享时间",
      shareHeroCacheHit: (pct: string) => `缓存命中 ${pct}`,
      shareHeroBigTokens: (tokens: string) => `${tokens} tokens`,
      shareHeroLongRun: (duration: string) => `单任务用了 ${duration}`,
      shareHeroRiskSignals: (n: number) => `${n} 条风险信号`,
      shareHeroFailedStep: (step: number) => `在第 ${step} 步失败`,
      shareHeroStepReplay: (steps: number) => `${steps} 步可回放`,
      shareCaptionCacheHit: (cached: string, steps: number) => `Agent 在 ${steps} 步中复用了 ${cached} 缓存 tokens。`,
      shareCaptionBigTokens: (steps: number) => `在 ${steps} 个推理步骤里全部消耗。`,
      shareCaptionLongRun: (steps: number) => `一次任务旅程，包含 ${steps} 个 Agent 步骤。`,
      shareCaptionRiskSignals: "Agent 推理链路中出现可观测异常。",
      shareCaptionFailed: "Agent 未能到达一个可验证的终点。",
      shareCaptionStepReplay: (duration: string) => `一段可追溯的 Agent 旅程，总时长 ${duration}。`,
      shareStoryTemplate: (provider: string, steps: number, title: string) => `${provider} 用 ${steps} 步处理：${title}`,
      shareSkillsUsed: (names: string) => `用到的能力：${names}`,
      shareVerdictCleared: "通关",
      shareVerdictFailed: "失败",
      shareVerdictRunning: "进行中",
      shareVerdictNoteCleared: "已抵达最终回复并附带证据。",
      shareVerdictNoteFailed: (title: string) => `停在：${title}`,
      shareVerdictNoteRunning: "Agent 仍在处理这个任务。",
      shareVerdictRisks: (n: number) => `沿途出现 ${n} 条风险信号`,
      shareTimelineAria: "按阶段排列的快照时间线",
      shareStatsCompact: (tokens: string, duration: string, kv: string) => `${tokens} · ${duration} · KV ${kv}`,
      shareProviderUnknown: "编码 Agent",
      readoutSessions: "会话数",
      readoutEstCost: "估算费用",
      readoutTotalTokens: "总 Tokens",
      readoutToolCalls: "工具调用",
      readoutErrors: "错误数",
      pricingHeading: "Token 费率与费用假设",
      pricingNote: "标准 API 费率，USD / 1M tokens。Anthropic：输入 + 输出 + 缓存读取 (×0.1) + 缓存写入 (×1.25)。编辑任意字段重新计算费用。",
      pricingInputRate: "输入 $/M",
      pricingOutputRate: "输出 $/M",
      toolUsageHeading: "工具用量",
      toolUsageErrors: "错误",
      toolUsageEmpty: "该用户输入未记录工具调用。",
      searchPlaceholder: "按标题搜索...",
      sortLabel: "排序",
      sortNewest: "最新优先",
      sortCost: "费用最高",
      sortDuration: "时长最长",
      sortTools: "工具最多",
      sortErrors: "错误最多",
      dropzoneHint: "拖拽 JSONL 文件到此处",
      dropzoneActive: "松手导入",
      modelSpendHeading: "按模型费用",
      modelSpendEmpty: "无模型用量数据。",
      modelSpendModel: "模型",
      modelSpendMsgs: "消息数",
      modelSpendInput: "输入",
      modelSpendOutput: "输出",
      modelSpendCached: "缓存",
      modelSpendCost: "费用",
      modelSpendTotal: "合计",
      recapToggle: "会话概览",
      recapRhythmHeading: "节奏",
      recapDailyActivity: "日常活动",
      recapWhenYouShip: "编码时段",
      recapEfficiencyHeading: "效率",
      recapCacheHit: "缓存命中率",
      recapErrorRate: "错误率",
      recapTokensPerSession: "Token / 会话",
      recapCostPerSession: "费用 / 会话",
      recapEmpty: "暂无会话数据。"
    },
    evidence: {
      heading: "证据",
      loading: "加载中",
      kind: "类型",
      time: "时间",
      tool: "工具",
      call: "调用",
      noDetail: "没有捕获到详情。",
      artifacts: "Artifacts",
      inlineEvidence: "Inline evidence",
      noArtifacts: "这个事件没有附加 artifacts。",
      rawEvent: "原始事件",
      noRawEvent: "没有可用的原始事件引用。",
      empty: "选择一个 episode、timeline event 或 replay node，查看 redacted evidence。"
    },
    ingest: {
      kicker: "Ingest 关卡",
      completed: "城堡通关",
      failed: "关卡失败",
      running: "关卡运行中",
      files: "文件",
      phase: "阶段",
      current: "当前",
      waitingFile: "等待下一个文件",
      coins: "金币",
      clearedBlocks: "已清理砖块",
      hazards: "障碍",
      events: "事件",
      aria: (status: string, phase: string, processed: number, total: number, percent: number) => `Ingest ${status}，${phase}，已处理 ${processed}/${total} 个文件，进度 ${percent}%`
    },
    tokenChart: {
      defaultTitle: "按天 Token 用量",
      eyebrow: "Tokens",
      loading: "正在加载按天用量",
      visibleDays: (count: number) => `${count} 个可见日期`,
      noVisibleDays: "没有可见日期",
      summaryAria: "按天 token 用量摘要",
      totalTokens: "总 tokens",
      kvHit: "KV 命中",
      hideChart: "隐藏按天 token 用量图",
      showChart: "显示按天 token 用量图",
      breakdownAria: "可见 token 用量拆分",
      chartAria: "按天 token 用量图",
      chartTitle: "按日期统计的 token 用量",
      totalSuffix: "总 tokens",
      trendLabel: "趋势",
      tokenSuffix: "tokens",
      input: "Input",
      cachedInput: "Cached input",
      output: "Output",
      reasoning: "Reasoning",
      totalTrend: "总趋势",
      legendAria: "Token 用量图例",
      emptyLoading: "正在加载按天 token 用量...",
      empty: "还没有按天 token 用量。"
    },
    tour: {
      restart: "重新引导",
      skip: "跳过引导",
      next: "下一步",
      prev: "上一步",
      done: "完成",
      stepLabel: (current: number, total: number) => `第 ${current} / ${total} 步`,
      steps: [
        {
          title: "扫描 Agent 日志",
          detail: "将 SuperView 指向您的 Codex、Claude Code 或 OpenCode 日志目录，开始索引 Agent 运行记录。"
        },
        {
          title: "切换项目",
          detail: "浏览所有已索引的项目。按 provider 筛选，选择一个项目查看其时间线。"
        },
        {
          title: "会话概览",
          detail: "可折叠的分析仪表盘：会话数、Token 消耗、成本、每日活动日历、按时段热力图、效率指标、工具用量和按模型支出。"
        },
        {
          title: "每日 Token 用量",
          detail: "Horizon 图以紧凑分层色带展示每日 Token 消耗：缓存输入、输入、输出和推理 Token，与节奏面板并排陈列。"
        },
        {
          title: "用户输入",
          detail: "每条用户消息生成一个任务旅程。点击任意旅程展开工具调用、证据和上下文回放。"
        },
        {
          title: "上下文回放",
          detail: "逐快照步进浏览 Agent 上下文窗口。观察上下文块的添加、修改和移除过程。"
        },
        {
          title: "上下文回放摘要",
          detail: "当前回放会话的快速概览：快照总数、上下文块数量、风险点和事件计数。"
        },
        {
          title: "上下文时间线",
          detail: "全宽工厂流水线视图，展示每个快照及其活跃上下文块随时间流动。一目了然。"
        },
        {
          title: "Token 时间线",
          detail: "点击对话头部图表按钮，打开 Token 时间线面板，查看各步骤的 Token 用量变化。"
        },
        {
          title: "主题与语言",
          detail: "5 种主题（明亮/暗色/森林/等离子紫/莫兰迪黄昏）切换，中英文切换，或点击顶栏 Map 按钮随时重新开始此引导。"
        }
      ]
    }
  }
};
