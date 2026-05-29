import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listCachedPlugins,
  pickRecommendedVersion,
  scanPlugin,
} from "../../../../src/adopt/importers/plugins.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-plugins-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkPlugin(mkt: string, name: string, version: string, withIdentity = true): string {
  const root = join(tmp, "plugins", "cache", mkt, name, version);
  mkdirSync(root, { recursive: true });
  if (withIdentity) {
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version, description: "x" }),
    );
  }
  return root;
}

describe("listCachedPlugins", () => {
  it("groups versions per (marketplace, plugin)", () => {
    mkPlugin("mkt", "p1", "1.0.0");
    mkPlugin("mkt", "p1", "1.1.0");
    mkPlugin("mkt", "p2", "0.1.0");
    const groups = listCachedPlugins(join(tmp, "plugins", "cache"));
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.plugin === "p1")?.versions).toEqual(["1.0.0", "1.1.0"]);
  });

  it("missing cache root → empty", () => {
    expect(listCachedPlugins(join(tmp, "nope"))).toEqual([]);
  });
});

describe("pickRecommendedVersion", () => {
  it("returns highest by semver when all semver-valid", () => {
    expect(pickRecommendedVersion(["1.0.0", "1.1.0", "0.9.0"])).toBe("1.1.0");
  });

  it("returns null when any version fails semver", () => {
    expect(pickRecommendedVersion(["1.0.0", "abc123"])).toBeNull();
  });
});

describe("scanPlugin", () => {
  it("missing .claude-plugin/plugin.json → one synthetic unimportable", () => {
    const root = mkPlugin("mkt", "broken", "1.0.0", false);
    const r = scanPlugin(root, { marketplace: "mkt", plugin: "broken", version: "1.0.0" });
    expect(r.unimportable).toHaveLength(1);
    expect(r.unimportable[0]?.reason).toMatch(/missing \.claude-plugin\/plugin\.json/);
    expect(r.importable).toEqual([]);
  });

  it("surfaces commands/ as single unimportable line (not per-file)", () => {
    const root = mkPlugin("mkt", "p", "1.0.0");
    mkdirSync(join(root, "commands"), { recursive: true });
    writeFileSync(join(root, "commands", "a.md"), "x");
    writeFileSync(join(root, "commands", "b.md"), "y");
    const r = scanPlugin(root, { marketplace: "mkt", plugin: "p", version: "1.0.0" });
    const cmds = r.unimportable.filter((i) => /slash commands/i.test(i.reason ?? ""));
    expect(cmds).toHaveLength(1);
  });

  it("dispatches to skills/agents/hooks/mcps importers", () => {
    const root = mkPlugin("mkt", "p", "1.0.0");
    mkdirSync(join(root, "skills", "demo"), { recursive: true });
    writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
    const r = scanPlugin(root, { marketplace: "mkt", plugin: "p", version: "1.0.0" });
    expect(r.importable.find((i) => i.kind === "skills" && i.leaf === "demo")).toBeDefined();
  });
});
