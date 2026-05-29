import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scan } from "../../../src/adopt/scan.ts";
import type { ResolvedOrigin } from "../../../src/adopt/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-scan-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkSkill(root: string, leaf: string): void {
  const dir = join(root, "skills", leaf);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${leaf}\n---\n`);
}

describe("scan", () => {
  it("aggregates direct + plugin items into ScanReport", () => {
    const home = join(tmp, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkSkill(join(home, ".claude"), "direct-skill");
    const pluginRoot = join(home, ".claude", "plugins", "cache", "mkt", "p", "1.0.0");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "p", version: "1.0.0" }),
    );
    mkSkill(pluginRoot, "plugin-skill");

    const origin: ResolvedOrigin = { kind: "global", root: join(home, ".claude") };
    const artifactRoot = join(tmp, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });

    const report = scan(origin, { artifactRoot, sourceName: "claude" });
    const leaves = report.importable.map((i) => i.leaf).sort();
    expect(leaves).toContain("direct-skill");
    expect(leaves).toContain("plugin-skill");
  });

  it("marks already-imported items when target dir exists", () => {
    const home = join(tmp, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkSkill(join(home, ".claude"), "existing");

    const artifactRoot = join(tmp, "artifacts");
    mkdirSync(join(artifactRoot, "skills", "claude", "existing"), { recursive: true });

    const origin: ResolvedOrigin = { kind: "global", root: join(home, ".claude") };
    const report = scan(origin, { artifactRoot, sourceName: "claude" });
    const existing = report.importable.find((i) => i.leaf === "existing");
    expect(existing?.status).toBe("already-imported");
  });
});
