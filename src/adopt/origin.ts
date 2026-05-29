import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { UsageError } from "../errors.ts";
import { slugify } from "./slug.ts";
import type { ResolvedOrigin } from "./types.ts";

export type OriginChoice = { kind: "global" } | { kind: "project"; path: string };

export interface OriginCtx {
  home: string;
}

export function resolveOrigin(choice: OriginChoice, ctx: OriginCtx): ResolvedOrigin {
  if (choice.kind === "global") {
    const root = join(ctx.home, ".claude");
    if (!isDir(root)) {
      throw new UsageError(`umbel adopt: ~/.claude not found (looked at ${root})`);
    }
    return { kind: "global", root };
  }
  const absPath = resolve(choice.path);
  if (!isDir(absPath)) {
    throw new UsageError(`umbel adopt: project path does not exist: ${absPath}`);
  }
  const claudeDir = join(absPath, ".claude");
  if (!isDir(claudeDir)) {
    throw new UsageError(`umbel adopt: project path has no .claude/ directory: ${absPath}`);
  }
  return { kind: "project", root: claudeDir };
}

export function defaultSourceNameFor(origin: ResolvedOrigin): string {
  if (origin.kind === "global") return "claude";
  if (origin.kind === "project") {
    const projDir = origin.root.replace(/\/\.claude$/, "");
    return `claude-project-${slugify(basename(projDir))}`;
  }
  return `cc-plugin-${slugify(`${origin.marketplace}-${origin.plugin}`)}`;
}

function isDir(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}
