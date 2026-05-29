import { isAbsolute, join, resolve } from "node:path";
import { UsageError } from "../errors.ts";
import { runAdoptWizard as runWizard } from "../ui/adopt-wizard.ts";
import { parseAdoptArgs } from "./args.ts";
import { readMeta } from "./meta.ts";
import { executeRefresh } from "./refresh.ts";
import type { ResolvedOrigin } from "./types.ts";

const ADOPT_HELP = `
umbel adopt — interactive import of existing Claude Code artifacts.

  umbel adopt                       Run the interactive wizard.
  umbel adopt --dry-run             Walk the wizard, print the plan, write nothing.
  umbel adopt --refresh <source>    Re-import a previously-adopted source bucket
                                    (uses .adopt-meta/<source>.json to know which
                                    items to delete; hand-rolled siblings preserved).
  umbel adopt -h, --help            Show this help.
`.trimStart();

export async function runAdopt(
  rest: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<number> {
  const args = parseAdoptArgs(rest);
  if (args.help) {
    process.stdout.write(ADOPT_HELP);
    return 0;
  }
  if (!isInteractive(env)) {
    throw new UsageError("umbel adopt: requires a TTY");
  }
  const home = env.HOME ?? "";
  const artifactRoot = artifactRootFor(env);

  let refreshOrigin: ResolvedOrigin | undefined;
  if (args.refreshSource !== null) {
    const meta = readMeta(artifactRoot, args.refreshSource);
    refreshOrigin = metaToOrigin(meta, home);
    if (!args.dryRun) executeRefresh(artifactRoot, args.refreshSource);
  }

  return runWizard({
    cwd,
    home,
    artifactRoot,
    dryRun: args.dryRun,
    ...(refreshOrigin ? { refreshOrigin } : {}),
  });
}

function isInteractive(env: NodeJS.ProcessEnv): boolean {
  if (env.NO_TTY === "1") return false;
  return Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
}

function artifactRootFor(env: NodeJS.ProcessEnv): string {
  const explicit = env.UMBEL_ARTIFACTS_DIR;
  if (explicit && explicit.length > 0) {
    return isAbsolute(explicit) ? explicit : resolve(explicit);
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(env.HOME ?? "", ".config");
  return join(base, "umbel");
}

function metaToOrigin(meta: ReturnType<typeof readMeta>, home: string): ResolvedOrigin {
  if (meta.origin.type === "global") return { kind: "global", root: join(home, ".claude") };
  if (meta.origin.type === "project") {
    return { kind: "project", root: join(meta.origin.path, ".claude") };
  }
  return {
    kind: "plugin",
    root: "",
    marketplace: meta.origin.marketplace,
    plugin: meta.origin.plugin,
    version: "",
  };
}
