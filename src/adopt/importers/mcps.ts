import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "../../bundle/manifest.ts";
import type { AdoptableItem } from "../types.ts";

export interface McpScanOpts {
  root: string;
  originGroup: string;
  originLabel: string;
}

export function scanMcps(opts: McpScanOpts): AdoptableItem[] {
  const items: AdoptableItem[] = [];
  pushFromJson(join(opts.root, ".mcp.json"), "mcpServers", opts, items);
  pushFromJson(join(opts.root, "settings.json"), "mcpServers", opts, items);
  return items;
}

function pushFromJson(
  path: string,
  key: "mcpServers",
  opts: McpScanOpts,
  out: AdoptableItem[],
): void {
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    out.push({
      kind: "mcps",
      leaf: pathToSyntheticLeaf(path),
      originGroup: opts.originGroup,
      originLabel: opts.originLabel,
      source: { type: "mcp-json", jsonPath: path, serverName: "<file>", config: { command: "" } },
      status: "unimportable",
      reason: `${path}: ${(e as Error).message.split("\n", 1)[0]}`,
    });
    return;
  }
  const o = (parsed as Record<string, unknown> | null) ?? {};
  const servers = (o as Record<string, unknown>)[key];
  if (servers === null || servers === undefined) return;
  if (typeof servers !== "object") return;
  for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
    out.push(makeMcpItem(name, raw, path, opts));
  }
}

function makeMcpItem(
  name: string,
  raw: unknown,
  jsonPath: string,
  opts: McpScanOpts,
): AdoptableItem {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  const transport = cfg.type;
  const command = cfg.command;
  const baseSource = {
    type: "mcp-json" as const,
    jsonPath,
    serverName: name,
    config: cfg as McpServerConfig,
  };
  const base: Omit<AdoptableItem, "status" | "reason"> = {
    kind: "mcps",
    leaf: name,
    originGroup: opts.originGroup,
    originLabel: opts.originLabel,
    source: baseSource,
  };
  if (transport !== undefined && transport !== "stdio") {
    return {
      ...base,
      status: "unimportable",
      reason: `umbel supports stdio MCP servers only (got type='${String(transport)}')`,
    };
  }
  if (typeof command !== "string" || command.length === 0) {
    return {
      ...base,
      status: "unimportable",
      reason: "missing 'command' for stdio MCP server",
    };
  }
  return { ...base, status: "ready" };
}

function pathToSyntheticLeaf(path: string): string {
  return path.split("/").slice(-2).join("-").replace(/\W+/g, "-");
}
