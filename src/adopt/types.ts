import type { ArtifactKind } from "../bundle/kinds.ts";
import type { HookCommand, McpServerConfig } from "../bundle/manifest.ts";

export type ResolvedOrigin =
  | { kind: "global"; root: string }
  | { kind: "project"; root: string }
  | { kind: "plugin"; root: string; marketplace: string; plugin: string; version: string };

export type ImporterSource =
  | { type: "dir"; path: string }
  | {
      type: "settings-hook";
      settingsPath: string;
      event: string;
      matcher: string;
      entry: HookCommand;
    }
  | {
      type: "mcp-json";
      jsonPath: string;
      serverName: string;
      config: McpServerConfig;
    };

export type AdoptStatus = "ready" | "already-imported" | "unimportable";

export interface AdoptableItem {
  kind: ArtifactKind;
  leaf: string;
  originGroup: string;
  originLabel: string;
  source: ImporterSource;
  status: AdoptStatus;
  reason?: string;
}

export interface ScanReport {
  origin: ResolvedOrigin;
  importable: AdoptableItem[];
  unimportable: AdoptableItem[];
}

export interface PlannedWrite {
  targetDir: string;
  files: Array<{
    relPath: string;
    from: { kind: "copy"; src: string } | { kind: "content"; data: string };
  }>;
}

export interface ImportPlanItem {
  item: AdoptableItem;
  sourceName: string;
  writes: PlannedWrite[];
}

export interface ImportPlan {
  origin: ResolvedOrigin;
  defaultSourceName: string;
  items: ImportPlanItem[];
}

export type AdoptMetaOrigin =
  | { type: "global" }
  | { type: "project"; path: string }
  | { type: "plugin"; marketplace: string; plugin: string };

export interface AdoptMeta {
  source: string;
  lastAdoptedAt: string;
  origin: AdoptMetaOrigin;
  items: Array<{ kind: ArtifactKind; leaf: string }>;
}
