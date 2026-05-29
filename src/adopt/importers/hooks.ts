import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { HookCommand } from "../../bundle/manifest.ts";
import type { AdoptableItem } from "../types.ts";

export interface HookScanOpts {
  root: string;
  originGroup: string;
  originLabel: string;
  mode: "direct" | "plugin";
}

export function scanHooks(opts: HookScanOpts): AdoptableItem[] {
  const out: AdoptableItem[] = [];
  if (opts.mode === "direct") {
    scanSettingsHooks(join(opts.root, "settings.json"), opts, out);
  } else {
    scanPluginHooks(opts.root, opts, out);
  }
  return out;
}

function scanSettingsHooks(path: string, opts: HookScanOpts, out: AdoptableItem[]): void {
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    out.push(unimportable(opts, "settings", `${path}: ${(e as Error).message.split("\n", 1)[0]}`));
    return;
  }
  const hooks = (parsed as Record<string, unknown> | null)?.hooks;
  if (hooks === null || hooks === undefined) return;
  collectFromHooksObject(hooks, path, opts.root, opts, out, "direct");
}

function scanPluginHooks(pluginRoot: string, opts: HookScanOpts, out: AdoptableItem[]): void {
  const hjsonPath = join(pluginRoot, "hooks", "hooks.json");
  if (!existsSync(hjsonPath)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(hjsonPath, "utf8"));
  } catch (e) {
    out.push(
      unimportable(opts, "settings", `${hjsonPath}: ${(e as Error).message.split("\n", 1)[0]}`),
    );
    return;
  }
  collectFromHooksObject(parsed, hjsonPath, pluginRoot, opts, out, "plugin");
}

function collectFromHooksObject(
  raw: unknown,
  configPath: string,
  pluginRoot: string,
  opts: HookScanOpts,
  out: AdoptableItem[],
  scope: "direct" | "plugin",
): void {
  if (typeof raw !== "object" || raw === null) return;
  for (const [event, specsRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(specsRaw)) continue;
    for (const spec of specsRaw) {
      const s = spec as { matcher?: unknown; hooks?: unknown };
      const matcher = s.matcher;
      const entries = s.hooks;
      if (typeof matcher !== "string" || !Array.isArray(entries)) {
        out.push(
          unimportable(opts, "settings", `${configPath}: invalid hook spec under '${event}'`),
        );
        continue;
      }
      for (const entry of entries) {
        out.push(buildItem(event, matcher, entry, configPath, pluginRoot, opts, scope));
      }
    }
  }
}

function buildItem(
  event: string,
  matcher: string,
  rawEntry: unknown,
  configPath: string,
  pluginRoot: string,
  opts: HookScanOpts,
  scope: "direct" | "plugin",
): AdoptableItem {
  const entry = (rawEntry ?? {}) as Record<string, unknown> & HookCommand;
  if (event.length === 0) return unimportable(opts, "settings", "empty 'event'");
  if (entry.type !== "command")
    return unimportable(opts, "settings", `${configPath}: hook 'type' must be 'command'`);
  const command = entry.command;
  if (typeof command !== "string" || command.length === 0) {
    return unimportable(opts, "settings", `${configPath}: hook missing 'command'`);
  }
  const classify = classifyCommand(command, pluginRoot, scope);
  if (classify.kind === "unimportable") {
    return unimportable(opts, "settings", classify.reason);
  }
  const leaf = classify.leaf;
  return {
    kind: "hooks",
    leaf,
    originGroup: opts.originGroup,
    originLabel: opts.originLabel,
    source: {
      type: "settings-hook",
      settingsPath: configPath,
      event,
      matcher,
      entry: { ...entry, command } as HookCommand,
      // crossDirRel + pluginRoot smuggled via index signature so write.ts can pick them up
      ...(classify.crossDirRel ? { crossDirRel: classify.crossDirRel } : {}),
      ...(classify.pluginRoot ? { pluginRoot: classify.pluginRoot } : {}),
    } as never,
    status: "ready",
  };
}

interface ClassifyResult {
  kind: "leaf";
  leaf: string;
  crossDirRel?: string;
  pluginRoot?: string;
}
interface ClassifyFail {
  kind: "unimportable";
  reason: string;
}

const PLUGIN_ROOT_PREFIX = "${CLAUDE_PLUGIN_ROOT}/";

function classifyCommand(
  command: string,
  pluginRoot: string,
  scope: "direct" | "plugin",
): ClassifyResult | ClassifyFail {
  const trimmed = command.trim();

  if (scope === "plugin" && trimmed.startsWith(PLUGIN_ROOT_PREFIX)) {
    const rel = trimmed.slice(PLUGIN_ROOT_PREFIX.length).split(/\s+/, 1)[0] ?? "";
    if (rel.startsWith("hooks/")) {
      const fileBase = basename(rel);
      return { kind: "leaf", leaf: stripExt(fileBase) };
    }
    const onDisk = join(pluginRoot, rel);
    if (!existsSync(onDisk)) {
      return {
        kind: "unimportable",
        reason: `command references missing plugin file ${rel}`,
      };
    }
    const fileBase = basename(rel);
    return { kind: "leaf", leaf: stripExt(fileBase), crossDirRel: rel, pluginRoot };
  }

  if (scope === "direct" && trimmed.startsWith("./")) {
    return {
      kind: "unimportable",
      reason: "command references path outside plugin root",
    };
  }

  // Inline command (anything else: bare 'docker …', absolute paths, etc.)
  return { kind: "leaf", leaf: inlineLeaf(command) };
}

function inlineLeaf(command: string): string {
  const slug32 = command
    .toLowerCase()
    .slice(0, 32)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hash4 = createHash("sha256").update(command).digest("hex").slice(0, 4);
  const base = slug32.length > 0 ? slug32 : "hook";
  return `${base}-${hash4}`;
}

function stripExt(s: string): string {
  const ext = extname(s);
  return ext.length > 0 ? s.slice(0, -ext.length) : s;
}

function unimportable(opts: HookScanOpts, _tag: string, reason: string): AdoptableItem {
  return {
    kind: "hooks",
    leaf: inlineLeaf(reason),
    originGroup: opts.originGroup,
    originLabel: opts.originLabel,
    source: {
      type: "settings-hook",
      settingsPath: "",
      event: "",
      matcher: "",
      entry: { type: "command", command: "" },
    },
    status: "unimportable",
    reason,
  };
}
