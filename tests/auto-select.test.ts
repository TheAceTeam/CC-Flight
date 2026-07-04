import { describe, expect, it } from "vitest";
import { resolveAutoSelectId, type AutoSelectProject } from "../ui/src/autoSelect";

const projects: AutoSelectProject[] = [
  { id: "p_aimarketing", cwd: "/Users/sean/workspace/AIMarketing" },
  { id: "p_superview", cwd: "/Users/sean/workspace/exp/CC-Flight" },
  { id: "p_ppt", cwd: "/Users/sean/workspace/guizang-ppt-skill" },
];

describe("resolveAutoSelectId", () => {
  it("selects the project whose cwd exactly matches the launch dir", () => {
    expect(
      resolveAutoSelectId(projects, "/Users/sean/workspace/exp/CC-Flight", null),
    ).toBe("p_superview");
  });

  it("prefers the launch dir over the URL ?project= hint", () => {
    expect(
      resolveAutoSelectId(
        projects,
        "/Users/sean/workspace/exp/CC-Flight",
        "/Users/sean/workspace/AIMarketing",
      ),
    ).toBe("p_superview");
  });

  it("falls back to the URL ?project= hint when no launch dir is set", () => {
    expect(
      resolveAutoSelectId(projects, null, "/Users/sean/workspace/AIMarketing"),
    ).toBe("p_aimarketing");
  });

  it("matches via endsWith fallback (trailing-slash / nested differences)", () => {
    const withTrailingSlash: AutoSelectProject[] = [
      { id: "p_superview", cwd: "/host/Users/sean/workspace/exp/CC-Flight" },
    ];
    expect(
      resolveAutoSelectId(
        withTrailingSlash,
        "/Users/sean/workspace/exp/CC-Flight",
        null,
      ),
    ).toBe("p_superview");
  });

  it("does not match an unrelated sibling or parent directory", () => {
    const siblings: AutoSelectProject[] = [
      { id: "p_exp", cwd: "/Users/sean/workspace/exp" },
      { id: "p_other", cwd: "/Users/sean/workspace/exp/CC-FlightOther" },
    ];
    expect(
      resolveAutoSelectId(siblings, "/Users/sean/workspace/exp/CC-Flight", null),
    ).toBeNull();
  });

  // The regression: on a cold launch the launch-dir project is not ingested by
  // the first scan, so resolution must return null (caller keeps retrying)...
  it("returns null when the launch-dir project has not been scanned yet", () => {
    const partialScan: AutoSelectProject[] = [
      { id: "p_aimarketing", cwd: "/Users/sean/workspace/AIMarketing" },
    ];
    expect(
      resolveAutoSelectId(
        partialScan,
        "/Users/sean/workspace/exp/CC-Flight",
        null,
      ),
    ).toBeNull();
  });

  // ...and once the scan completes and the project appears, it resolves.
  it("resolves the target once the full scan adds the launch-dir project", () => {
    const partialScan: AutoSelectProject[] = [
      { id: "p_aimarketing", cwd: "/Users/sean/workspace/AIMarketing" },
    ];
    const target = "/Users/sean/workspace/exp/CC-Flight";
    expect(resolveAutoSelectId(partialScan, target, null)).toBeNull();
    const fullScan = [
      ...partialScan,
      { id: "p_superview", cwd: target },
    ];
    expect(resolveAutoSelectId(fullScan, target, null)).toBe("p_superview");
  });

  it("returns null when neither launch dir nor URL hint is provided", () => {
    expect(resolveAutoSelectId(projects, null, null)).toBeNull();
  });

  it("ignores projects with a null cwd", () => {
    const withNullCwd: AutoSelectProject[] = [
      { id: "p_null", cwd: null },
      { id: "p_superview", cwd: "/Users/sean/workspace/exp/CC-Flight" },
    ];
    expect(
      resolveAutoSelectId(withNullCwd, "/Users/sean/workspace/exp/CC-Flight", null),
    ).toBe("p_superview");
  });
});
