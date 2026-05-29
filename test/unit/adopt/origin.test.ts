import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSourceNameFor, resolveOrigin } from "../../../src/adopt/origin.ts";
import { UsageError } from "../../../src/errors.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-adopt-origin-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveOrigin", () => {
  it("global: resolves home + .claude", () => {
    const fakeHome = tmp;
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    const o = resolveOrigin({ kind: "global" }, { home: fakeHome });
    expect(o).toEqual({ kind: "global", root: join(fakeHome, ".claude") });
  });

  it("global: missing ~/.claude → UsageError", () => {
    expect(() => resolveOrigin({ kind: "global" }, { home: tmp })).toThrow(UsageError);
  });

  it("project: validates path exists and contains .claude/", () => {
    const proj = join(tmp, "my-app");
    mkdirSync(join(proj, ".claude"), { recursive: true });
    const o = resolveOrigin({ kind: "project", path: proj }, { home: tmp });
    expect(o).toEqual({ kind: "project", root: join(proj, ".claude") });
  });

  it("project: missing path → UsageError", () => {
    expect(() =>
      resolveOrigin({ kind: "project", path: join(tmp, "nope") }, { home: tmp }),
    ).toThrow(UsageError);
  });

  it("project: path exists but no .claude/ → UsageError", () => {
    const proj = join(tmp, "naked");
    mkdirSync(proj, { recursive: true });
    expect(() => resolveOrigin({ kind: "project", path: proj }, { home: tmp })).toThrow(UsageError);
  });
});

describe("defaultSourceNameFor", () => {
  it("global → 'claude'", () => {
    expect(defaultSourceNameFor({ kind: "global", root: "/anywhere/.claude" })).toBe("claude");
  });

  it("project → 'claude-project-<basename slug>'", () => {
    expect(defaultSourceNameFor({ kind: "project", root: "/home/u/My App/.claude" })).toBe(
      "claude-project-my-app",
    );
  });

  it("plugin → 'cc-plugin-<marketplace>-<plugin>' (single segment, version-agnostic)", () => {
    expect(
      defaultSourceNameFor({
        kind: "plugin",
        root: "/x",
        marketplace: "claude-plugins-official",
        plugin: "superpowers",
        version: "5.1.0",
      }),
    ).toBe("cc-plugin-claude-plugins-official-superpowers");
  });
});
