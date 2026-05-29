import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSourceNameFor } from "../../../src/adopt/origin.ts";
import { buildPlan } from "../../../src/adopt/plan.ts";
import { scan } from "../../../src/adopt/scan.ts";
import { writePlan } from "../../../src/adopt/write.ts";
import { compile } from "../../../src/bundle/compile.ts";
import { compose } from "../../../src/bundle/compose.ts";
import { ARTIFACT_KINDS } from "../../../src/bundle/kinds.ts";
import { type BundleManifest, loadManifest } from "../../../src/bundle/manifest.ts";
import { type ArtifactRoots, resolveSources } from "../../../src/bundle/resolve.ts";

describe("adopt → compile round-trip", () => {
  it("produces a compiled bundle layout matching the snapshot", () => {
    const tmp = mkdtempSync(join(tmpdir(), "umbel-rt-"));
    try {
      const home = join(tmp, "home");
      const claude = join(home, ".claude");
      mkdirSync(claude, { recursive: true });

      // 1. a basic skill
      const skillDir = join(claude, "skills", "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: demo\ndescription: a demo skill\n---\nbody\n",
      );

      // 2. a stdio mcp
      writeFileSync(
        join(claude, ".mcp.json"),
        JSON.stringify({ mcpServers: { fsmcp: { command: "fs-mcp" } } }),
      );

      // 3. a plugin hook with same-dir sidecar
      const pluginRoot = join(claude, "plugins", "cache", "mkt", "p", "1.0.0");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(pluginRoot, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "p", version: "1.0.0" }),
      );
      mkdirSync(join(pluginRoot, "hooks"), { recursive: true });
      writeFileSync(join(pluginRoot, "hooks", "log.sh"), "#!/bin/sh\necho hi\n");
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

      // --- adopt pipeline: scan → plan → write artifacts under artifactRoot ---
      const artifactRoot = join(tmp, "artifacts");
      const origin = { kind: "global" as const, root: claude };
      const sourceName = defaultSourceNameFor(origin);
      const report = scan(origin, {
        artifactRoot,
        sourceName,
        pluginVersionByGroup: { "mkt-p": "1.0.0" },
      });
      const selected = report.importable.filter((i) => i.status === "ready");
      const plan = buildPlan({ origin, defaultSourceName: sourceName, selected, artifactRoot });
      writePlan(plan, { artifactRoot });

      // Refs confirmed from the scan/plan: <source>/<leaf> where the adopt writer
      // laid out <artifactRoot>/<kind>/<source>/<leaf>/.
      //   skills → claude/demo     mcps → claude/fsmcp     hooks → cc-plugin-mkt-p/log
      const manifestPath = join(artifactRoot, "rt.md");
      writeFileSync(
        manifestPath,
        [
          "---",
          "name: rt",
          "skills: [claude/demo]",
          "hooks: [cc-plugin-mkt-p/log]",
          "mcps: [claude/fsmcp]",
          "---",
          "",
        ].join("\n"),
      );

      // --- real bundle pipeline: loadManifest → compose → resolveSources → compile ---
      const { manifest } = loadManifest(manifestPath);
      const index = new Map<string, BundleManifest>([[manifest.name, manifest]]);
      const resolved = compose(manifest.name, index);
      const roots = Object.fromEntries(
        ARTIFACT_KINDS.map((k) => [k, join(artifactRoot, k)]),
      ) as ArtifactRoots;
      const sources = resolveSources(resolved, { roots });

      const cacheRoot = join(tmp, "cache");
      const compiledDir = compile(resolved, sources, { cacheRoot });

      // Snapshot the compiled layout: relative path → file contents. Normalize the
      // hash (in the dir name + bundle.md) and absolute tmp paths so the snapshot
      // is deterministic across runs/machines.
      const hash = compiledDir.slice(compiledDir.lastIndexOf("-") + 1);
      const snapshot: Record<string, string> = {};
      walk(compiledDir, (abs, rel) => {
        const content = readFileSync(abs, "utf8");
        // Order matters: replace the full compiled dir path first (it ends in the
        // hash), then any remaining bare hash occurrences.
        snapshot[rel] = content
          .split(compiledDir)
          .join("<COMPILED_DIR>")
          .split(hash)
          .join("<HASH>");
      });
      expect(snapshot).toMatchSnapshot();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function walk(root: string, visit: (abs: string, rel: string) => void): void {
  function rec(dir: string): void {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      // statSync dereferences: compile symlinks skill/agent dirs at the source,
      // so we recurse into them to capture the linked-through contents.
      if (statSync(abs).isDirectory()) rec(abs);
      else visit(abs, relative(root, abs));
    }
  }
  rec(root);
}
