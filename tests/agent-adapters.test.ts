import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter, normalizeClaudeCodeJsonl } from "../runtime-node/adapters/claude-code";
import { codexAdapter } from "../runtime-node/adapters/codex";
import { opencodeAdapter } from "../runtime-node/adapters/opencode";

describe("agent log adapters", () => {
  it("normalizes Claude Code JSONL into the shared task journey model", async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), "superview-claude-home-"));
    try {
      const projectDir = path.join(sourceRoot, "projects", "-tmp-superview-multi-agent");
      mkdirSync(projectDir, { recursive: true });
      cpSync(path.resolve("tests/fixtures/claude-code-transcripts/sample-session.jsonl"), path.join(projectDir, "sample-session.jsonl"));

      const sources = await claudeCodeAdapter.scan({ provider: "claude-code", root: sourceRoot });
      expect(sources).toHaveLength(1);

      const bundle = requireBundle(await claudeCodeAdapter.parseSource(sources[0], { repoRoot: "/tmp/superview-multi-agent" }));
      expect(bundle.session).toMatchObject({
        id: "claude-code:claude-session-1",
        provider: "claude-code",
        externalSessionId: "claude-session-1",
        cliVersion: "1.2.3",
        modelProvider: "Anthropic"
      });
      expect(bundle.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "user_prompt", detail: "Review the checkout flow" }),
          expect.objectContaining({ kind: "assistant_message", detail: expect.stringContaining("inspect the checkout route") }),
          expect.objectContaining({ kind: "verification", callId: "toolu_1", detail: expect.stringContaining("PASS checkout.test.ts") })
        ])
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("uses Claude history project mapping instead of stale transcript cwd", async () => {
    const sourceRoot = mkdtempSync(path.join(tmpdir(), "superview-claude-history-home-"));
    const mappedProject = "/Users/sean/workspace/cangjie_oss/EasyExcel4CJ";
    try {
      const projectDir = path.join(sourceRoot, "projects", "-Users-sean-workspace-exp-CC-Flight");
      mkdirSync(projectDir, { recursive: true });
      writeFileSync(
        path.join(sourceRoot, "history.jsonl"),
        JSON.stringify({
          display: "plan/complete-mapping.toml 按计划执行...",
          project: mappedProject,
          sessionId: "history-session-1"
        })
      );
      writeFileSync(
        path.join(projectDir, "history-session-1.jsonl"),
        [
          JSON.stringify({
            cwd: "/Users/sean/workspace/exp/CC-Flight",
            sessionId: "history-session-1",
            version: "1.2.3",
            type: "user",
            message: {
              role: "user",
              content: "Implement the following plan:\n\n# Plan: complete-mapping.md -> complete-mapping.toml 转换"
            },
            timestamp: "2026-04-25T04:01:45.308Z"
          }),
          JSON.stringify({
            cwd: "/Users/sean/workspace/exp/CC-Flight",
            sessionId: "history-session-1",
            version: "1.2.3",
            type: "assistant",
            message: {
              role: "assistant",
              content: "I will work from the mapping plan."
            },
            timestamp: "2026-04-25T04:02:45.308Z"
          })
        ].join("\n")
      );

      const sources = await claudeCodeAdapter.scan({ provider: "claude-code", root: sourceRoot });
      expect(sources).toHaveLength(1);

      const bundle = requireBundle(await claudeCodeAdapter.parseSource(sources[0]));
      expect(bundle.project).toMatchObject({
        cwd: mappedProject,
        name: "EasyExcel4CJ"
      });
      expect(bundle.session.cwd).toBe(mappedProject);
      expect(bundle.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "user_prompt",
            detail: expect.stringContaining("complete-mapping.toml")
          })
        ])
      );
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("reads cwd/session metadata from the first record that carries it, not just line 0", () => {
    // Headless `claude -p` sessions open with a queue-operation line that has no
    // cwd/version. Metadata must be recovered from the first record that has each
    // field, otherwise cwd wrongly falls back to process.cwd().
    const realCwd = "/Users/sean/workspace/exp/ats_cj_tests/runs/arkts/run-01/project";
    const content = [
      JSON.stringify({
        type: "queue-operation",
        operation: "enqueue",
        sessionId: "headless-session-1",
        timestamp: "2026-06-21T05:00:00.000Z"
      }),
      JSON.stringify({
        cwd: realCwd,
        sessionId: "headless-session-1",
        version: "2.1.139",
        type: "user",
        message: { role: "user", content: "Build the fortune app" },
        timestamp: "2026-06-21T05:00:01.000Z"
      })
    ].join("\n");

    const bundle = requireBundle(
      normalizeClaudeCodeJsonl(content, `${realCwd}/session.jsonl`, null)
    );
    expect(bundle.session).toMatchObject({
      id: "claude-code:headless-session-1",
      cwd: realCwd,
      cliVersion: "2.1.139"
    });
    expect(bundle.project.cwd).toBe(realCwd);
    expect(bundle.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_prompt", detail: "Build the fortune app" })
      ])
    );
  });

  it("normalizes OpenCode export JSON into the shared task journey model", async () => {
    const exportPath = path.resolve("tests/fixtures/opencode-exports/sample-session.json");
    const bundle = requireBundle(await opencodeAdapter.parseSource({ provider: "opencode", id: exportPath, path: exportPath, sizeBytes: 0, mtimeMs: 0 }, { repoRoot: "/tmp/superview-multi-agent" }));

    expect(bundle.session).toMatchObject({
      id: "opencode:ses_superview_1",
      provider: "opencode",
      externalSessionId: "ses_superview_1",
      cliVersion: "1.14.29"
    });
    // The cwd must come from the v1.14.x `info.directory` field (the regression
    // that hid every opencode project under process.cwd()).
    expect(bundle.project.cwd).toBe("/tmp/superview-multi-agent");
    expect(bundle.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "user_prompt", detail: "Add onboarding empty state" }),
        expect.objectContaining({ kind: "assistant_message", detail: expect.stringContaining("patch the React entry view") }),
        expect.objectContaining({ kind: "file_change", toolName: "edit", callId: "tool_patch_1" }),
        expect.objectContaining({ kind: "file_change", callId: "tool_patch_1", detail: expect.stringContaining("Updated ui/src/App.tsx") })
      ])
    );
    expect(bundle.events.find((event) => event.kind === "assistant_message")?.tokenUsage).toEqual({
      input: 90,
      output: 25,
      reasoning: 0,
      cachedInput: 30,
      total: 115
    });
  });

  it("keeps Codex adapter compatible with existing rollout fixtures", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "superview-codex-home-"));
    try {
      cpSync(path.resolve("tests/fixtures/fake-codex-home"), codexHome, { recursive: true });
      const sources = await codexAdapter.scan({ provider: "codex", root: codexHome });
      expect(sources).toHaveLength(1);

      const bundle = requireBundle(await codexAdapter.parseSource(sources[0], { repoRoot: "/tmp/superview-fixture" }));
      expect(bundle.session.provider).toBe("codex");
      expect(bundle.session.id).toBe("codex:fixture-tool-session");
      expect(bundle.events.some((event) => event.kind === "file_change")).toBe(true);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it("discovers archived Codex rollout sessions", async () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "superview-codex-archive-home-"));
    try {
      cpSync(path.resolve("tests/fixtures/fake-codex-home"), codexHome, { recursive: true });
      const archiveDir = path.join(codexHome, "archived_sessions");
      mkdirSync(archiveDir, { recursive: true });
      cpSync(
        path.resolve("tests/fixtures/codex-rollouts/minimal-rollout.jsonl"),
        path.join(archiveDir, "rollout-2026-07-03T00-25-34-archive.jsonl"),
      );

      const sources = await codexAdapter.scan({ provider: "codex", root: codexHome });

      expect(sources).toHaveLength(2);
      expect(sources.some((source) => source.path.includes("archived_sessions"))).toBe(true);
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

function requireBundle<T>(bundle: T | null): T {
  if (!bundle) throw new Error("Expected adapter to return a normalized bundle");
  return bundle;
}
