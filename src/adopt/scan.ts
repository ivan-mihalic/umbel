import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanAgents } from "./importers/agents.ts";
import { scanHooks } from "./importers/hooks.ts";
import { scanMcps } from "./importers/mcps.ts";
import { type PluginGroup, listCachedPlugins, scanPlugin } from "./importers/plugins.ts";
import { scanSkills } from "./importers/skills.ts";
import type { AdoptableItem, ResolvedOrigin, ScanReport } from "./types.ts";

export interface ScanOpts {
  artifactRoot: string;
  sourceName: string;
  pluginVersionByGroup?: Record<string, string>;
}

export function scan(origin: ResolvedOrigin, opts: ScanOpts): ScanReport {
  const importable: AdoptableItem[] = [];
  const unimportable: AdoptableItem[] = [];

  if (origin.kind === "global" || origin.kind === "project") {
    const directGroup =
      origin.kind === "global"
        ? { originGroup: "claude", originLabel: "claude (global ~/.claude)" }
        : { originGroup: opts.sourceName, originLabel: `${origin.root}` };
    collect(scanSkills({ root: origin.root, ...directGroup }));
    collect(scanAgents({ root: origin.root, ...directGroup }));
    collect(scanHooks({ root: origin.root, mode: "direct", ...directGroup }));
    collect(scanMcps({ root: origin.root, ...directGroup }));

    if (origin.kind === "global") {
      collectPlugins(join(origin.root, "plugins", "cache"));
    }
  }

  for (const it of importable) {
    if (it.status === "ready" && isAlreadyImported(it, opts)) {
      it.status = "already-imported";
    }
  }

  return { origin, importable, unimportable };

  function collect(items: AdoptableItem[]): void {
    for (const it of items) {
      if (it.status === "unimportable") unimportable.push(it);
      else importable.push(it);
    }
  }

  function collectPlugins(cacheRoot: string): void {
    const groups = listCachedPlugins(cacheRoot);
    for (const g of groups) {
      const version = pickVersion(g, opts);
      if (version === null) continue;
      const root = g.rootByVersion[version];
      if (root === undefined) continue;
      const result = scanPlugin(root, {
        marketplace: g.marketplace,
        plugin: g.plugin,
        version,
      });
      for (const it of result.importable) importable.push(it);
      for (const it of result.unimportable) unimportable.push(it);
    }
  }
}

function pickVersion(g: PluginGroup, opts: ScanOpts): string | null {
  const key = `${g.marketplace}-${g.plugin}`;
  const chosen = opts.pluginVersionByGroup?.[key];
  if (chosen !== undefined) return chosen;
  if (g.versions.length === 1) return g.versions[0] ?? null;
  // Caller must run the pre-picker; the orchestrator alone has no UI.
  // For non-interactive scan paths (--dry-run TTY guard handles this elsewhere)
  // we conservatively skip multi-version plugins; the wizard will fill in
  // pluginVersionByGroup and re-scan.
  return null;
}

function isAlreadyImported(item: AdoptableItem, opts: ScanOpts): boolean {
  const targetDir = join(opts.artifactRoot, item.kind, opts.sourceName, item.leaf);
  return existsSync(targetDir);
}
