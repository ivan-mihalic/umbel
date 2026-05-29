import { existsSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface PathPromptCtx {
  home: string;
}

export function expandHomePath(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return join(home, input.slice(2));
  return input;
}

export function validateClaudeProjectPath(input: string, ctx: PathPromptCtx): string | undefined {
  const expanded = expandHomePath(input.trim(), ctx.home);
  const abs = isAbsolute(expanded) ? expanded : resolve(expanded);
  if (!existsSync(abs)) return `path does not exist: ${abs}`;
  try {
    if (!statSync(abs).isDirectory()) return `not a directory: ${abs}`;
  } catch {
    return `cannot stat path: ${abs}`;
  }
  if (!existsSync(join(abs, ".claude"))) return `no .claude/ directory under ${abs}`;
  return undefined;
}
