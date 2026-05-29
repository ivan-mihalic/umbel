import { existsSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { metaPath, readMeta } from "./meta.ts";
import type { AdoptMeta } from "./types.ts";

export interface RefreshPlan {
  meta: AdoptMeta;
  toDelete: Array<{ kind: ArtifactKind; leaf: string }>;
  handRolledSiblings: Array<{ kind: ArtifactKind; leaf: string }>;
}

export function planRefresh(artifactRoot: string, source: string): RefreshPlan {
  const meta = readMeta(artifactRoot, source);
  const managed = new Set(meta.items.map((i) => `${i.kind}/${i.leaf}`));
  const handRolledSiblings: Array<{ kind: ArtifactKind; leaf: string }> = [];
  for (const kind of ARTIFACT_KINDS) {
    const bucket = join(artifactRoot, kind, source);
    if (!existsSync(bucket)) continue;
    for (const leaf of readdirSync(bucket)) {
      if (!managed.has(`${kind}/${leaf}`)) {
        handRolledSiblings.push({ kind, leaf });
      }
    }
  }
  return { meta, toDelete: meta.items, handRolledSiblings };
}

export function executeRefresh(artifactRoot: string, source: string): void {
  const plan = planRefresh(artifactRoot, source);
  for (const { kind, leaf } of plan.toDelete) {
    const dir = join(artifactRoot, kind, source, leaf);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
  for (const kind of ARTIFACT_KINDS) {
    const bucket = join(artifactRoot, kind, source);
    if (existsSync(bucket) && readdirSync(bucket).length === 0) {
      rmSync(bucket, { recursive: true, force: true });
    }
  }
  if (existsSync(metaPath(artifactRoot, source))) {
    unlinkSync(metaPath(artifactRoot, source));
  }
}
