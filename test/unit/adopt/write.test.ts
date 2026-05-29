import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMeta } from "../../../src/adopt/meta.ts";
import { buildPlan } from "../../../src/adopt/plan.ts";
import type { AdoptableItem, ResolvedOrigin } from "../../../src/adopt/types.ts";
import { writePlan } from "../../../src/adopt/write.ts";

let tmp: string;
let artifactRoot: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-write-"));
  artifactRoot = join(tmp, "artifacts");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const ORIGIN: ResolvedOrigin = { kind: "global", root: "/anywhere/.claude" };

function mkSkillDir(name: string): string {
  const dir = join(tmp, "src", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`);
  return dir;
}

describe("writePlan", () => {
  it("materializes a skill copy and writes adopt metadata", () => {
    const srcDir = mkSkillDir("brainstorming");
    const item: AdoptableItem = {
      kind: "skills",
      leaf: "brainstorming",
      originGroup: "claude",
      originLabel: "claude",
      source: { type: "dir", path: srcDir },
      status: "ready",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot,
    });
    writePlan(plan, { artifactRoot });
    expect(existsSync(join(artifactRoot, "skills", "claude", "brainstorming", "SKILL.md"))).toBe(
      true,
    );
    const meta = readMeta(artifactRoot, "claude");
    expect(meta.items).toEqual([{ kind: "skills", leaf: "brainstorming" }]);
    expect(meta.origin).toEqual({ type: "global" });
  });

  it("hook with same-dir sidecar copies the whole hooks/ dir + writes HOOK.md", () => {
    const pluginRoot = join(tmp, "plugins", "p", "1.0.0");
    mkdirSync(join(pluginRoot, "hooks"), { recursive: true });
    writeFileSync(join(pluginRoot, "hooks", "log.sh"), "#!/bin/sh\necho\n");
    writeFileSync(
      join(pluginRoot, "hooks", "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          {
            matcher: "*",
            hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" }],
          },
        ],
      }),
    );
    const item: AdoptableItem = {
      kind: "hooks",
      leaf: "log",
      originGroup: "mkt-p@1.0.0",
      originLabel: "mkt/p@1.0.0",
      source: {
        type: "settings-hook",
        settingsPath: join(pluginRoot, "hooks", "hooks.json"),
        event: "PreToolUse",
        matcher: "*",
        entry: { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" },
        pluginRoot,
        sidecarsDir: join(pluginRoot, "hooks"),
      } as never,
      status: "ready",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot,
    });
    writePlan(plan, { artifactRoot });
    const target = join(artifactRoot, "hooks", "cc-plugin-mkt-p", "log");
    expect(existsSync(join(target, "HOOK.md"))).toBe(true);
    expect(existsSync(join(target, "log.sh"))).toBe(true);
    const hookMd = readFileSync(join(target, "HOOK.md"), "utf8");
    expect(hookMd).toMatch(/command: "\.\/log\.sh"/);
  });

  it("idempotent on already-imported items (status filter)", () => {
    const srcDir = mkSkillDir("x");
    const item: AdoptableItem = {
      kind: "skills",
      leaf: "x",
      originGroup: "claude",
      originLabel: "claude",
      source: { type: "dir", path: srcDir },
      status: "already-imported",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot,
    });
    writePlan(plan, { artifactRoot });
    const meta = readMeta(artifactRoot, "claude");
    expect(meta.items).toEqual([]);
  });
});
