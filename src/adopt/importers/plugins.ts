import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import type { AdoptableItem } from "../types.ts";
import { scanAgents } from "./agents.ts";
import { scanHooks } from "./hooks.ts";
import { scanMcps } from "./mcps.ts";
import { scanSkills } from "./skills.ts";

export interface PluginIdentity {
  marketplace: string;
  plugin: string;
  version: string;
}

export interface PluginGroup {
  marketplace: string;
  plugin: string;
  versions: string[];
  rootByVersion: Record<string, string>;
}

export interface PluginScanResult {
  importable: AdoptableItem[];
  unimportable: AdoptableItem[];
}

export function listCachedPlugins(cacheRoot: string): PluginGroup[] {
  if (!safeIsDir(cacheRoot)) return [];
  const out: PluginGroup[] = [];
  for (const mktName of safeListDirs(cacheRoot)) {
    const mktDir = join(cacheRoot, mktName);
    for (const pluginName of safeListDirs(mktDir)) {
      const pluginDir = join(mktDir, pluginName);
      const versions = safeListDirs(pluginDir).sort();
      if (versions.length === 0) continue;
      const rootByVersion: Record<string, string> = {};
      for (const v of versions) rootByVersion[v] = join(pluginDir, v);
      out.push({ marketplace: mktName, plugin: pluginName, versions, rootByVersion });
    }
  }
  return out;
}

export function pickRecommendedVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  if (!versions.every((v) => semver.valid(v) !== null)) return null;
  return [...versions].sort(semver.compare).pop() ?? null;
}

const GROUP_LABEL_VERSION_SUFFIX = "@";

export function scanPlugin(root: string, ident: PluginIdentity): PluginScanResult {
  const importable: AdoptableItem[] = [];
  const unimportable: AdoptableItem[] = [];

  const identityFile = join(root, ".claude-plugin", "plugin.json");
  if (!existsSync(identityFile)) {
    unimportable.push({
      kind: "skills",
      leaf: `${ident.marketplace}-${ident.plugin}-${ident.version}`,
      originGroup: groupSlug(ident),
      originLabel: groupLabel(ident),
      source: { type: "dir", path: root },
      status: "unimportable",
      reason: `cache/${ident.marketplace}/${ident.plugin}/${ident.version} — missing .claude-plugin/plugin.json (likely partial install)`,
    });
    return { importable, unimportable };
  }
  try {
    JSON.parse(readFileSync(identityFile, "utf8"));
  } catch (e) {
    unimportable.push({
      kind: "skills",
      leaf: `${ident.marketplace}-${ident.plugin}-${ident.version}`,
      originGroup: groupSlug(ident),
      originLabel: groupLabel(ident),
      source: { type: "dir", path: root },
      status: "unimportable",
      reason: `cache/${ident.marketplace}/${ident.plugin}/${ident.version} — malformed plugin.json: ${(e as Error).message.split("\n", 1)[0]}`,
    });
    return { importable, unimportable };
  }

  const opts = { root, originGroup: groupSlug(ident), originLabel: groupLabel(ident) };
  collect(scanSkills(opts), importable, unimportable);
  collect(scanAgents(opts), importable, unimportable);
  collect(scanHooks({ ...opts, mode: "plugin" }), importable, unimportable);
  collect(scanMcps(opts), importable, unimportable);

  if (safeIsDir(join(root, "commands"))) {
    unimportable.push({
      kind: "skills",
      leaf: `${ident.plugin}-commands`,
      originGroup: groupSlug(ident),
      originLabel: groupLabel(ident),
      source: { type: "dir", path: join(root, "commands") },
      status: "unimportable",
      reason: "Claude Code slash commands (not modeled by umbel)",
    });
  }

  return { importable, unimportable };
}

function groupSlug(id: PluginIdentity): string {
  return `${id.marketplace}-${id.plugin}${GROUP_LABEL_VERSION_SUFFIX}${id.version}`;
}
function groupLabel(id: PluginIdentity): string {
  return `${id.marketplace}/${id.plugin}@${id.version}`;
}

function collect(items: AdoptableItem[], imp: AdoptableItem[], unimp: AdoptableItem[]): void {
  for (const it of items) {
    if (it.status === "unimportable") unimp.push(it);
    else imp.push(it);
  }
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeListDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
