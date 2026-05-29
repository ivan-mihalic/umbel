import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ArtifactKind } from "../bundle/kinds.ts";
import { ApplyError } from "../errors.ts";
import { writeMeta } from "./meta.ts";
import type {
  AdoptMeta,
  AdoptMetaOrigin,
  ImportPlan,
  ImportPlanItem,
  PlannedWrite,
} from "./types.ts";

export interface WriteOpts {
  artifactRoot: string;
}

export function writePlan(plan: ImportPlan, opts: WriteOpts): void {
  const writtenBySource: Map<string, Array<{ kind: ArtifactKind; leaf: string }>> = new Map();
  let succeeded = 0;
  let failureMessage: string | null = null;

  for (const planItem of plan.items) {
    if (planItem.item.status !== "ready") continue;
    try {
      materializeItem(planItem);
      const arr = writtenBySource.get(planItem.sourceName) ?? [];
      arr.push({ kind: planItem.item.kind, leaf: planItem.item.leaf });
      writtenBySource.set(planItem.sourceName, arr);
      succeeded += 1;
    } catch (e) {
      failureMessage = `wrote ${succeeded} of ${plan.items.length} before failure: ${(e as Error).message.split("\n", 1)[0]}`;
      break;
    }
  }

  for (const [source, items] of writtenBySource) {
    const meta: AdoptMeta = {
      source,
      lastAdoptedAt: new Date().toISOString(),
      origin: toMetaOrigin(plan),
      items,
    };
    writeMeta(opts.artifactRoot, meta);
  }
  // Always write metadata for the default source even when empty, so refresh
  // round-trips deterministically through the "already-imported" path.
  if (!writtenBySource.has(plan.defaultSourceName)) {
    writeMeta(opts.artifactRoot, {
      source: plan.defaultSourceName,
      lastAdoptedAt: new Date().toISOString(),
      origin: toMetaOrigin(plan),
      items: writtenBySource.get(plan.defaultSourceName) ?? [],
    });
  }

  if (failureMessage !== null) throw new ApplyError(failureMessage);
}

function materializeItem(planItem: ImportPlanItem): void {
  for (const w of planItem.writes) {
    mkdirSync(w.targetDir, { recursive: true });
    materializeWrite(w, planItem);
  }
}

function materializeWrite(w: PlannedWrite, planItem: ImportPlanItem): void {
  // Plugin-hook special case: copy the whole sidecars dir first.
  const src = planItem.item.source as unknown as { sidecarsDir?: string };
  if (src.sidecarsDir !== undefined && existsSync(src.sidecarsDir)) {
    cpSync(src.sidecarsDir, w.targetDir, { recursive: true, dereference: true });
  }
  for (const f of w.files) {
    if (f.from.kind === "copy") {
      if (f.relPath === ".") {
        cpSync(f.from.src, w.targetDir, { recursive: true, dereference: true });
      } else {
        const dst = join(w.targetDir, f.relPath);
        mkdirSync(dirname(dst), { recursive: true });
        cpSync(f.from.src, dst, { recursive: true, dereference: true });
      }
    } else {
      const dst = join(w.targetDir, f.relPath);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, f.from.data);
    }
  }
}

function toMetaOrigin(plan: ImportPlan): AdoptMetaOrigin {
  const o = plan.origin;
  if (o.kind === "global") return { type: "global" };
  if (o.kind === "project") {
    const projPath = o.root.replace(/\/\.claude$/, "");
    return { type: "project", path: projPath };
  }
  return { type: "plugin", marketplace: o.marketplace, plugin: o.plugin };
}
