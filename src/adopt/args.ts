import { UsageError } from "../errors.ts";

export interface AdoptArgs {
  dryRun: boolean;
  refreshSource: string | null;
  help: boolean;
}

export function parseAdoptArgs(argv: string[]): AdoptArgs {
  const out: AdoptArgs = { dryRun: false, refreshSource: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    const eq = a.indexOf("=");
    const flag = eq >= 0 ? a.slice(0, eq) : a;
    const rawInline = eq >= 0 ? a.slice(eq + 1) : undefined;
    switch (flag) {
      case "--dry-run":
        out.dryRun = true;
        break;
      case "--refresh": {
        const next = rawInline ?? argv[i + 1];
        if (next === undefined || next.startsWith("-")) {
          throw new UsageError("--refresh requires a source name");
        }
        out.refreshSource = next;
        if (rawInline === undefined) i++;
        break;
      }
      case "-h":
      case "--help":
        out.help = true;
        break;
      default:
        if (a.startsWith("-")) throw new UsageError(`umbel adopt: unknown flag: ${a}`);
        throw new UsageError(`umbel adopt: unexpected argument: ${a}`);
    }
  }
  return out;
}
