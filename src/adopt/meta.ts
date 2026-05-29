import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { NotFoundError, UsageError } from "../errors.ts";
import type { AdoptMeta } from "./types.ts";

export const META_DIR = ".adopt-meta";

export function metaPath(artifactRoot: string, source: string): string {
  return join(artifactRoot, META_DIR, `${source}.json`);
}

export function readMeta(artifactRoot: string, source: string): AdoptMeta {
  const p = metaPath(artifactRoot, source);
  if (!existsSync(p)) {
    throw new NotFoundError(
      `no adopt metadata for source '${source}'; manual cleanup required (the source was not created by adopt, or its metadata was deleted)`,
    );
  }
  let raw: string;
  try {
    raw = readFileSync(p, "utf8");
  } catch (e) {
    throw new UsageError(
      `umbel adopt: cannot read ${p}: ${(e as Error).message.split("\n", 1)[0]}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new UsageError(
      `umbel adopt: malformed adopt metadata at ${p}: ${(e as Error).message.split("\n", 1)[0]}`,
    );
  }
  return validateMeta(parsed, p);
}

export function writeMeta(artifactRoot: string, meta: AdoptMeta): void {
  const p = metaPath(artifactRoot, meta.source);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(meta, null, 2)}\n`);
}

function validateMeta(parsed: unknown, p: string): AdoptMeta {
  if (typeof parsed !== "object" || parsed === null) {
    throw new UsageError(`umbel adopt: malformed metadata at ${p}: not an object`);
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.source !== "string" || o.source.length === 0) {
    throw new UsageError(`umbel adopt: malformed metadata at ${p}: missing 'source'`);
  }
  if (typeof o.lastAdoptedAt !== "string") {
    throw new UsageError(`umbel adopt: malformed metadata at ${p}: missing 'lastAdoptedAt'`);
  }
  if (typeof o.origin !== "object" || o.origin === null) {
    throw new UsageError(`umbel adopt: malformed metadata at ${p}: missing 'origin'`);
  }
  if (!Array.isArray(o.items)) {
    throw new UsageError(`umbel adopt: malformed metadata at ${p}: missing 'items'`);
  }
  for (const it of o.items) {
    if (typeof it !== "object" || it === null) {
      throw new UsageError(`umbel adopt: malformed metadata at ${p}: invalid item entry`);
    }
    const item = it as Record<string, unknown>;
    if (!(ARTIFACT_KINDS as readonly string[]).includes(item.kind as string)) {
      throw new UsageError(
        `umbel adopt: malformed metadata at ${p}: unknown kind ${String(item.kind)}`,
      );
    }
    if (typeof item.leaf !== "string" || item.leaf.length === 0) {
      throw new UsageError(`umbel adopt: malformed metadata at ${p}: missing leaf`);
    }
  }
  return parsed as AdoptMeta;
}
