import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { ArtifactKind } from "../../bundle/kinds.ts";
import type { AdoptableItem } from "../types.ts";

export interface DirImporterOpts {
  root: string;
  originGroup: string;
  originLabel: string;
}

export function scanSkills(opts: DirImporterOpts): AdoptableItem[] {
  return scanNamedArtifactDir({ ...opts, kind: "skills", mdFile: "SKILL.md" });
}

export interface NamedArtifactOpts extends DirImporterOpts {
  kind: ArtifactKind;
  mdFile: string;
}

export function scanNamedArtifactDir(opts: NamedArtifactOpts): AdoptableItem[] {
  const kindRoot = join(opts.root, opts.kind);
  if (!existsSync(kindRoot)) return [];
  const items: AdoptableItem[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(kindRoot);
  } catch {
    return [];
  }
  for (const name of entries) {
    const dir = join(kindRoot, name);
    if (!safeIsDir(dir)) continue;
    const md = join(dir, opts.mdFile);
    if (!existsSync(md)) continue;
    items.push(parseNamedArtifact(dir, name, md, opts));
  }
  return resolveDuplicateNames(items, opts.mdFile);
}

function parseNamedArtifact(
  dir: string,
  basename: string,
  mdPath: string,
  opts: NamedArtifactOpts,
): AdoptableItem {
  let raw: string;
  try {
    raw = readFileSync(mdPath, "utf8");
  } catch (e) {
    return mkItem(opts, basename, dir, {
      status: "unimportable",
      reason: `${(e as NodeJS.ErrnoException).code ?? "EREAD"}: ${(e as Error).message.split("\n", 1)[0]}`,
    });
  }
  let fmName: string | undefined;
  try {
    const parsed = matter(raw);
    const n = (parsed.data as Record<string, unknown>).name;
    if (typeof n === "string" && n.length > 0) fmName = n;
  } catch (e) {
    return mkItem(opts, basename, dir, {
      status: "unimportable",
      reason: `invalid YAML in ${opts.mdFile}: ${(e as Error).message.split("\n", 1)[0]}`,
    });
  }
  return mkItem(opts, fmName ?? basename, dir, { status: "ready" });
}

function mkItem(
  opts: NamedArtifactOpts,
  leaf: string,
  dirPath: string,
  patch: { status: AdoptableItem["status"]; reason?: string },
): AdoptableItem {
  const it: AdoptableItem = {
    kind: opts.kind,
    leaf,
    originGroup: opts.originGroup,
    originLabel: opts.originLabel,
    source: { type: "dir", path: dirPath },
    status: patch.status,
  };
  if (patch.reason !== undefined) it.reason = patch.reason;
  return it;
}

function resolveDuplicateNames(items: AdoptableItem[], mdFile: string): AdoptableItem[] {
  const byLeaf = new Map<string, AdoptableItem[]>();
  for (const it of items) {
    if (it.status !== "ready") continue;
    const arr = byLeaf.get(it.leaf) ?? [];
    arr.push(it);
    byLeaf.set(it.leaf, arr);
  }
  for (const [leaf, dups] of byLeaf) {
    if (dups.length < 2) continue;
    const dirs = dups.map((d) => (d.source.type === "dir" ? d.source.path : "?"));
    for (let i = 0; i < dups.length; i++) {
      const others = dirs.filter((_, j) => j !== i);
      const it = dups[i] as AdoptableItem;
      it.status = "unimportable";
      it.reason = `duplicate canonical name '${leaf}' in ${mdFile} (also in ${others.join(", ")})`;
    }
  }
  return items;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
