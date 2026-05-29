import { join } from "node:path";
import type {
  AdoptableItem,
  ImportPlan,
  ImportPlanItem,
  PlannedWrite,
  ResolvedOrigin,
} from "./types.ts";

export interface PlanOpts {
  origin: ResolvedOrigin;
  defaultSourceName: string;
  selected: AdoptableItem[];
  artifactRoot: string;
}

export function buildPlan(opts: PlanOpts): ImportPlan {
  const items: ImportPlanItem[] = opts.selected.map((item) => {
    const sourceName = sourceNameFor(item, opts);
    const targetDir = join(opts.artifactRoot, item.kind, sourceName, item.leaf);
    const writes: PlannedWrite[] = [planWrite(item, targetDir)];
    return { item, sourceName, writes };
  });
  return {
    origin: opts.origin,
    defaultSourceName: opts.defaultSourceName,
    items,
  };
}

function sourceNameFor(item: AdoptableItem, opts: PlanOpts): string {
  // Plugin items embed `<mkt>-<plugin>@<version>` in originGroup.
  // Strip the @<version> suffix for the version-agnostic source bucket.
  const g = item.originGroup;
  const at = g.indexOf("@");
  if (at >= 0) return `cc-plugin-${g.slice(0, at)}`;
  return opts.defaultSourceName;
}

function planWrite(item: AdoptableItem, targetDir: string): PlannedWrite {
  if (item.source.type === "dir") {
    return {
      targetDir,
      files: [{ relPath: ".", from: { kind: "copy", src: item.source.path } }],
    };
  }
  if (item.source.type === "settings-hook") {
    const extra = item.source as unknown as {
      crossDirRel?: string;
      pluginRoot?: string;
    };
    const files: PlannedWrite["files"] = [
      { relPath: "HOOK.md", from: { kind: "content", data: renderHookMd(item) } },
    ];
    if (extra.crossDirRel && extra.pluginRoot) {
      files.push({
        relPath: extra.crossDirRel,
        from: { kind: "copy", src: join(extra.pluginRoot, extra.crossDirRel) },
      });
    }
    // The whole plugin <plugin>/hooks/ directory copy (per design's plugin-hooks
    // case) is appended by the writer when it detects `entry.command` references
    // a same-dir sidecar. Keeping that fan-out in the writer rather than here
    // lets the planner stay pure: it deals only in explicit content + copy ops.
    return { targetDir, files };
  }
  if (item.source.type === "mcp-json") {
    return {
      targetDir,
      files: [{ relPath: "MCP.md", from: { kind: "content", data: renderMcpMd(item) } }],
    };
  }
  return { targetDir, files: [] };
}

function renderHookMd(item: AdoptableItem): string {
  if (item.source.type !== "settings-hook") return "";
  const s = item.source;
  const { type: _type, command: _cmd, ...passThrough } = s.entry as Record<string, unknown>;
  const lines = [
    "---",
    `name: ${item.leaf}`,
    `event: ${s.event}`,
    `matcher: ${s.matcher}`,
    `command: ${rewriteCommand(s.entry.command, item)}`,
  ];
  for (const [k, v] of Object.entries(passThrough)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function renderMcpMd(item: AdoptableItem): string {
  if (item.source.type !== "mcp-json") return "";
  const cfg = item.source.config;
  const { command, type: _type, ...passThrough } = cfg as Record<string, unknown>;
  const lines = ["---", `name: ${item.leaf}`, `command: ${command}`];
  for (const [k, v] of Object.entries(passThrough)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function rewriteCommand(command: string, _item: AdoptableItem): string {
  const trimmed = command.trim();
  const prefix = "${CLAUDE_PLUGIN_ROOT}/";
  if (trimmed.startsWith(prefix)) {
    const rel = trimmed.slice(prefix.length);
    // hooks/<file>... → ./<file>...
    if (rel.startsWith("hooks/")) return `./${rel.slice("hooks/".length)}`;
    return `./${rel}`;
  }
  return command;
}
