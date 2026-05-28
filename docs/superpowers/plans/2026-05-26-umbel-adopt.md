# `umbel adopt` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new interactive verb `umbel adopt` that imports existing Claude Code artifacts (skills, agents, hooks, MCP servers — including plugin-shipped ones) from `~/.claude/`, a project `.claude/`, or `~/.claude/plugins/cache/` into `$UMBEL_ARTIFACTS_DIR`, with a per-source metadata sidecar so future `--refresh` runs only touch adopt-managed items.

**Architecture:** A new self-contained `src/adopt/` subsystem (importers + scan + plan + write + meta + refresh + slug) plus one wizard (`src/ui/adopt-wizard.ts`) and one validator helper (`src/ui/path-prompt.ts`). The verb is wired into the dispatcher via **purely additive** edits: one entry in `BUNDLE_VERBS`, one help-text line, one dispatch case in `src/run.ts`. Nothing in `src/bundle/` or `src/source/` is modified — this is the non-regression contract codified as acceptance criterion #11 of the design.

**Tech Stack:** TypeScript / Node ESM (Node ≥18.17), `@clack/prompts` for the wizard, `gray-matter` for frontmatter, `semver` for plugin version recommendation, `vitest` for tests, `biome` for lint/format. Build via `tsup` → `dist/cli.js`.

**Design contract:** `docs/adopt-design.md`. Read it before starting. Every decision below traces back to that doc — do **not** improvise on conflict policy, slug rules, metadata shape, or hook command rewriting; the design is authoritative.

**Non-regression guarantee (load-bearing):** Per AC #11, no file under `src/bundle/`, `src/source/`, or any existing test may be edited. New tests live exclusively under `test/unit/adopt/`. The only allowed edits to *existing* files are:
- `src/args.ts` — add `"adopt"` to `BUNDLE_VERBS`, add one line to the `HELP` string.
- `src/run.ts` — add one import and one `if (verb === "adopt") …` branch in `runBundleVerb`.
- `README.md` — additive Quickstart bullet + section.
- `CHANGELOG.md` — additive entry under `## Unreleased`.

If at any point you feel the urge to touch `src/bundle/compile.ts` or another existing module, stop and re-read AC #11. The adopt writer is responsible for producing artifact directories that the *existing* compiler already understands — adapt the writer, never the compiler.

**Plan layout:** ~22 tasks. Each is one TDD cycle (write failing test → run it → implement → run it → commit). Run `npm test` after every commit to confirm AC #11 (full pre-existing suite still passes). If anything outside `test/unit/adopt/` fails, you have broken non-regression — revert and reconsider.

---

## Task 0: Pre-flight check

**Files:** none

- [ ] **Step 1: Confirm clean worktree on the adopt branch**

Run: `git status && git rev-parse --abbrev-ref HEAD`
Expected: clean working tree on `worktree-feat+adopt` (or whatever branch you're using for this feature); design doc + overview already committed.

- [ ] **Step 2: Capture the baseline pre-existing test count**

Run: `npm test 2>&1 | tail -5`
Expected: All tests pass. Note the test-file count (currently 14 files in `test/unit/`). After every later commit this number must only grow, never shrink, and no pre-existing file may report a failure.

- [ ] **Step 3: Verify the design doc is in place**

Run: `test -f docs/adopt-design.md && echo OK`
Expected: `OK`

---

## Task 1: Verb scaffolding (stub dispatch)

**Files:**
- Modify: `src/args.ts` (add `"adopt"` to `BUNDLE_VERBS`, add help line)
- Modify: `src/run.ts` (add stub dispatch branch)
- Test: `test/unit/adopt/verb-dispatch.test.ts` (new)

Stub returns `UsageError("umbel adopt: not yet implemented")` so the verb is recognised and the CLI exits with code 2. Later tasks replace the body.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/verb-dispatch.test.ts
import { describe, expect, it } from "vitest";
import { BUNDLE_VERBS, parseSubcommand } from "../../../src/args.ts";

describe("umbel adopt verb registration", () => {
  it("adopt is in BUNDLE_VERBS", () => {
    expect(BUNDLE_VERBS.has("adopt")).toBe(true);
  });

  it("parseSubcommand recognises 'adopt' as a verb", () => {
    expect(parseSubcommand(["adopt"])).toEqual({
      kind: "verb",
      verb: "adopt",
      rest: [],
    });
  });

  it("parseSubcommand forwards flags as rest", () => {
    expect(parseSubcommand(["adopt", "--dry-run", "--refresh", "claude"])).toEqual({
      kind: "verb",
      verb: "adopt",
      rest: ["--dry-run", "--refresh", "claude"],
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/verb-dispatch.test.ts`
Expected: FAIL — `BUNDLE_VERBS.has("adopt")` is false.

- [ ] **Step 3: Edit `src/args.ts`**

Add `"adopt"` to the `BUNDLE_VERBS` set. After the change the set reads:

```ts
export const BUNDLE_VERBS = new Set([
  "run",
  "apply",
  "unpin",
  "list",
  "show",
  "init",
  "build",
  "gc",
  "adopt",
]);
```

Then add a line to the `HELP` template literal under the `Bundle verbs:` block, immediately after the `umbel gc` line:

```
  umbel adopt                         Interactive import of existing Claude Code artifacts.
```

- [ ] **Step 4: Edit `src/run.ts` to stub-dispatch adopt**

In `runBundleVerb`, add a branch **before** the final fall-through to `runBundleInit`:

```ts
if (verb === "adopt") {
  throw new UsageError("umbel adopt: not yet implemented");
}
```

Add the `UsageError` import at the top of `src/run.ts` if it is not already imported (check existing imports — error classes may already be wired). If not present:

```ts
import { UsageError } from "./errors.ts";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/unit/adopt/verb-dispatch.test.ts && npm test`
Expected: new file passes; **full pre-existing suite still passes unchanged**.

- [ ] **Step 6: Commit**

```bash
git add src/args.ts src/run.ts test/unit/adopt/verb-dispatch.test.ts
git commit -m "feat(adopt): register 'adopt' verb (stub dispatch)"
```

---

## Task 2: Types module

**Files:**
- Create: `src/adopt/types.ts`
- Test: `test/unit/adopt/types.test.ts` (compile-only assertion)

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/types.test.ts
import { describe, expect, it } from "vitest";
import type {
  AdoptableItem,
  AdoptMeta,
  ImportPlan,
  ImporterSource,
  PlannedWrite,
  ResolvedOrigin,
  ScanReport,
} from "../../../src/adopt/types.ts";

describe("adopt types", () => {
  it("AdoptableItem accepts a ready skill", () => {
    const item: AdoptableItem = {
      kind: "skills",
      leaf: "brainstorming",
      originGroup: "claude-plugins-official-superpowers@5.2.0",
      originLabel: "claude-plugins-official/superpowers@5.2.0",
      source: { type: "dir", path: "/abs/skill/dir" },
      status: "ready",
    };
    expect(item.status).toBe("ready");
  });

  it("AdoptMeta accepts a global origin", () => {
    const meta: AdoptMeta = {
      source: "claude",
      lastAdoptedAt: "2026-05-26T00:00:00Z",
      origin: { type: "global" },
      items: [{ kind: "skills", leaf: "x" }],
    };
    expect(meta.origin.type).toBe("global");
  });

  it("ImporterSource discriminates by type", () => {
    const s: ImporterSource = { type: "dir", path: "/x" };
    expect(s.type).toBe("dir");
  });
});

type _Static =
  | ScanReport
  | ImportPlan
  | PlannedWrite
  | ResolvedOrigin;
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/types.test.ts`
Expected: FAIL — module `../../../src/adopt/types.ts` not found.

- [ ] **Step 3: Create `src/adopt/types.ts`**

```ts
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
  files: Array<{ relPath: string; from: { kind: "copy"; src: string } | { kind: "content"; data: string } }>;
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/adopt/types.test.ts && npx tsc --noEmit && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/types.ts test/unit/adopt/types.test.ts
git commit -m "feat(adopt): define types module (AdoptableItem, ScanReport, ImportPlan, AdoptMeta)"
```

---

## Task 3: Slug helper

**Files:**
- Create: `src/adopt/slug.ts`
- Test: `test/unit/adopt/slug.test.ts`

Per design "Slug rules": lowercase, non-alnum runs → single `-`, no Unicode normalization, trim leading/trailing `-`, empty result is invalid.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/slug.test.ts
import { describe, expect, it } from "vitest";
import { slugify, isValidSlug } from "../../../src/adopt/slug.ts";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("Foo")).toBe("foo");
  });

  it("collapses runs of non-alnum to single dash", () => {
    expect(slugify("foo bar/baz_qux.lol")).toBe("foo-bar-baz-qux-lol");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("--foo--")).toBe("foo");
    expect(slugify("@@@foo@@@")).toBe("foo");
  });

  it("collapses adjacent non-alnum runs to single dash", () => {
    expect(slugify("foo  ___  bar")).toBe("foo-bar");
  });

  it("non-ASCII passes through as non-alnum (no NFKD)", () => {
    expect(slugify("föö")).toBe("f");
    expect(slugify("Žluťoučký")).toBe("lu-ou-k");
  });

  it("returns empty string for input with no alnum", () => {
    expect(slugify("---@@@")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("rejects empty", () => {
    expect(isValidSlug("")).toBe(false);
  });

  it("accepts simple alnum + dash", () => {
    expect(isValidSlug("foo")).toBe(true);
    expect(isValidSlug("foo-bar")).toBe(true);
    expect(isValidSlug("claude-project-foo")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/slug.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/slug.ts`**

```ts
export function slugify(input: string): string {
  const lower = input.toLowerCase();
  const replaced = lower.replace(/[^a-z0-9]+/g, "-");
  return replaced.replace(/^-+/, "").replace(/-+$/, "");
}

export function isValidSlug(s: string): boolean {
  return s.length > 0 && /^[a-z0-9-]+$/.test(s);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/slug.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/slug.ts test/unit/adopt/slug.test.ts
git commit -m "feat(adopt): slugify helper for reserved source names"
```

---

## Task 4: Origin resolver

**Files:**
- Create: `src/adopt/origin.ts`
- Test: `test/unit/adopt/origin.test.ts`
- Test fixtures: `test/unit/adopt/fixtures/origins/` (created on the fly via `mkdirSync` in `beforeEach`)

Resolves a user choice `{kind: "global" | "project", path?: string}` into a `ResolvedOrigin` and derives the default reserved source-name slug. Validates path existence + presence of `.claude/`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/origin.test.ts
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  defaultSourceNameFor,
  resolveOrigin,
} from "../../../src/adopt/origin.ts";
import { UsageError } from "../../../src/errors.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-adopt-origin-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("resolveOrigin", () => {
  it("global: resolves home + .claude", () => {
    const fakeHome = tmp;
    mkdirSync(join(fakeHome, ".claude"), { recursive: true });
    const o = resolveOrigin({ kind: "global" }, { home: fakeHome });
    expect(o).toEqual({ kind: "global", root: join(fakeHome, ".claude") });
  });

  it("global: missing ~/.claude → UsageError", () => {
    expect(() => resolveOrigin({ kind: "global" }, { home: tmp })).toThrow(UsageError);
  });

  it("project: validates path exists and contains .claude/", () => {
    const proj = join(tmp, "my-app");
    mkdirSync(join(proj, ".claude"), { recursive: true });
    const o = resolveOrigin({ kind: "project", path: proj }, { home: tmp });
    expect(o).toEqual({ kind: "project", root: join(proj, ".claude") });
  });

  it("project: missing path → UsageError", () => {
    expect(() =>
      resolveOrigin({ kind: "project", path: join(tmp, "nope") }, { home: tmp }),
    ).toThrow(UsageError);
  });

  it("project: path exists but no .claude/ → UsageError", () => {
    const proj = join(tmp, "naked");
    mkdirSync(proj, { recursive: true });
    expect(() => resolveOrigin({ kind: "project", path: proj }, { home: tmp })).toThrow(
      UsageError,
    );
  });
});

describe("defaultSourceNameFor", () => {
  it("global → 'claude'", () => {
    expect(defaultSourceNameFor({ kind: "global", root: "/anywhere/.claude" })).toBe("claude");
  });

  it("project → 'claude-project-<basename slug>'", () => {
    expect(
      defaultSourceNameFor({ kind: "project", root: "/home/u/My App/.claude" }),
    ).toBe("claude-project-my-app");
  });

  it("plugin → 'cc-plugin-<marketplace>-<plugin>' (single segment, version-agnostic)", () => {
    expect(
      defaultSourceNameFor({
        kind: "plugin",
        root: "/x",
        marketplace: "claude-plugins-official",
        plugin: "superpowers",
        version: "5.1.0",
      }),
    ).toBe("cc-plugin-claude-plugins-official-superpowers");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/origin.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/origin.ts`**

```ts
import { existsSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { UsageError } from "../errors.ts";
import { slugify } from "./slug.ts";
import type { ResolvedOrigin } from "./types.ts";

export type OriginChoice =
  | { kind: "global" }
  | { kind: "project"; path: string };

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
    throw new UsageError(
      `umbel adopt: project path has no .claude/ directory: ${absPath}`,
    );
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/origin.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/origin.ts test/unit/adopt/origin.test.ts
git commit -m "feat(adopt): origin resolver + default-source-name derivation"
```

---

## Task 5: Metadata sidecar I/O

**Files:**
- Create: `src/adopt/meta.ts`
- Test: `test/unit/adopt/meta.test.ts`

Per design, `$UMBEL_ARTIFACTS_DIR/.adopt-meta/<source>.json` is the source of truth for `--refresh`. The reader must distinguish:
- file missing → `NotFoundError("no adopt metadata for source '<source>'…")`
- file malformed → `UsageError("…malformed adopt metadata at <path>: <first JSON error>")`

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/meta.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaPath, readMeta, writeMeta } from "../../../src/adopt/meta.ts";
import { NotFoundError, UsageError } from "../../../src/errors.ts";
import type { AdoptMeta } from "../../../src/adopt/types.ts";

let artifactRoot: string;
beforeEach(() => {
  artifactRoot = mkdtempSync(join(tmpdir(), "umbel-adopt-meta-"));
});
afterEach(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
});

const SAMPLE: AdoptMeta = {
  source: "claude",
  lastAdoptedAt: "2026-05-26T00:00:00Z",
  origin: { type: "global" },
  items: [
    { kind: "skills", leaf: "brainstorming" },
    { kind: "hooks", leaf: "log-bash" },
  ],
};

describe("meta sidecar", () => {
  it("metaPath joins .adopt-meta/<source>.json", () => {
    expect(metaPath(artifactRoot, "claude")).toBe(
      join(artifactRoot, ".adopt-meta", "claude.json"),
    );
  });

  it("writeMeta creates the dir and writes valid JSON", () => {
    writeMeta(artifactRoot, SAMPLE);
    const raw = readFileSync(metaPath(artifactRoot, "claude"), "utf8");
    expect(JSON.parse(raw)).toEqual(SAMPLE);
  });

  it("readMeta round-trips", () => {
    writeMeta(artifactRoot, SAMPLE);
    expect(readMeta(artifactRoot, "claude")).toEqual(SAMPLE);
  });

  it("readMeta missing file → NotFoundError", () => {
    expect(() => readMeta(artifactRoot, "claude")).toThrow(NotFoundError);
  });

  it("readMeta malformed JSON → UsageError", () => {
    const p = metaPath(artifactRoot, "claude");
    writeFileSync(p.replace(/claude\.json$/, ""), ""); // ensure dir exists below
    // workaround: just write the file directly via the helper API once impl exists
    writeMeta(artifactRoot, SAMPLE);
    writeFileSync(p, "{ not json");
    expect(() => readMeta(artifactRoot, "claude")).toThrow(UsageError);
  });

  it("readMeta validates shape (missing 'items' → UsageError)", () => {
    writeMeta(artifactRoot, SAMPLE);
    const p = metaPath(artifactRoot, "claude");
    writeFileSync(p, JSON.stringify({ source: "claude", origin: { type: "global" } }));
    expect(() => readMeta(artifactRoot, "claude")).toThrow(UsageError);
  });

  it("writeMeta does not create file when only writing the helper dir", () => {
    expect(existsSync(metaPath(artifactRoot, "other"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/meta.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/meta.ts`**

```ts
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
    if (!ARTIFACT_KINDS.includes(item.kind as ArtifactKind)) {
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/meta.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/meta.ts test/unit/adopt/meta.test.ts
git commit -m "feat(adopt): metadata sidecar read/write/validate"
```

---

## Task 6: Skills importer

**Files:**
- Create: `src/adopt/importers/skills.ts`
- Test: `test/unit/adopt/importers/skills.test.ts`
- Fixtures: `test/unit/adopt/fixtures/skills/` — created on the fly in `beforeEach`.

Per design: leaf = frontmatter `name:` else dir basename; bad frontmatter → `unimportable` with first-line error; duplicate canonical names → **both** items marked unimportable.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/importers/skills.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanSkills } from "../../../../src/adopt/importers/skills.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-skills-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkSkill(name: string, frontmatter: string): string {
  const dir = join(tmp, "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\n${frontmatter}\n---\nbody\n`);
  return dir;
}

const GROUP = { originGroup: "g", originLabel: "G" };

describe("scanSkills", () => {
  it("returns 'ready' items keyed by frontmatter name when present", () => {
    mkSkill("brainstorming", "name: brainstorming\ndescription: x");
    const items = scanSkills({ root: tmp, ...GROUP });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "skills",
      leaf: "brainstorming",
      status: "ready",
    });
  });

  it("falls back to dir basename when no name in frontmatter", () => {
    mkSkill("my-skill", "description: x");
    const items = scanSkills({ root: tmp, ...GROUP });
    expect(items[0]?.leaf).toBe("my-skill");
  });

  it("malformed YAML → unimportable with first-line reason", () => {
    mkSkill("broken", "description: { unbalanced");
    const items = scanSkills({ root: tmp, ...GROUP });
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("unimportable");
    expect(items[0]?.reason).toMatch(/YAML|YAMLException|invalid/i);
  });

  it("missing SKILL.md silently skipped (not a user-authored artifact)", () => {
    mkdirSync(join(tmp, "skills", "empty-dir"), { recursive: true });
    const items = scanSkills({ root: tmp, ...GROUP });
    expect(items).toHaveLength(0);
  });

  it("duplicate canonical name marks BOTH unimportable cross-referencing each other", () => {
    mkSkill("a", "name: foo");
    mkSkill("b", "name: foo");
    const items = scanSkills({ root: tmp, ...GROUP });
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.status === "unimportable")).toBe(true);
    expect(items[0]?.reason).toMatch(/duplicate canonical name 'foo'/);
    expect(items[1]?.reason).toMatch(/duplicate canonical name 'foo'/);
  });

  it("missing skills/ dir → empty result (no throw)", () => {
    expect(scanSkills({ root: tmp, ...GROUP })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/importers/skills.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/importers/skills.ts`**

Uses a shared core that the agents importer will also call. Put the core inline here; refactor in task 7 if useful.

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/importers/skills.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/importers/skills.ts test/unit/adopt/importers/skills.test.ts
git commit -m "feat(adopt): skills importer (frontmatter name + duplicate detection)"
```

---

## Task 7: Agents importer

**Files:**
- Create: `src/adopt/importers/agents.ts`
- Test: `test/unit/adopt/importers/agents.test.ts`

Agents share the same shape as skills (`<root>/agents/<leaf>/AGENT.md`). Reuse `scanNamedArtifactDir` from task 6.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/importers/agents.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanAgents } from "../../../../src/adopt/importers/agents.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-agents-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkAgent(name: string, fm: string): void {
  const dir = join(tmp, "agents", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "AGENT.md"), `---\n${fm}\n---\n`);
}

describe("scanAgents", () => {
  it("reads valid AGENT.md", () => {
    mkAgent("reviewer", "name: code-reviewer\ndescription: x");
    const items = scanAgents({ root: tmp, originGroup: "g", originLabel: "G" });
    expect(items[0]).toMatchObject({ kind: "agents", leaf: "code-reviewer", status: "ready" });
  });

  it("missing agents/ dir → empty", () => {
    expect(
      scanAgents({ root: tmp, originGroup: "g", originLabel: "G" }),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/importers/agents.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/importers/agents.ts`**

```ts
import { type DirImporterOpts, scanNamedArtifactDir } from "./skills.ts";
import type { AdoptableItem } from "../types.ts";

export function scanAgents(opts: DirImporterOpts): AdoptableItem[] {
  return scanNamedArtifactDir({ ...opts, kind: "agents", mdFile: "AGENT.md" });
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/importers/agents.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/importers/agents.ts test/unit/adopt/importers/agents.test.ts
git commit -m "feat(adopt): agents importer (reuses named-artifact-dir scanner)"
```

---

## Task 8: MCP importer

**Files:**
- Create: `src/adopt/importers/mcps.ts`
- Test: `test/unit/adopt/importers/mcps.test.ts`

Per design: parse `.mcp.json` + `settings.json[mcpServers]`. Leaf = JSON key. Validation: `type` absent or `"stdio"` → ready; `"http"` / `"sse"` / other → `unimportable` (transport not supported); missing `command` → `unimportable`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/importers/mcps.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanMcps } from "../../../../src/adopt/importers/mcps.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-mcps-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const G = { originGroup: "g", originLabel: "G" };

describe("scanMcps", () => {
  it("reads stdio mcpServers from .mcp.json", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { atlassian: { command: "uvx", args: ["atlassian-mcp"] } } }),
    );
    const items = scanMcps({ root: tmp, ...G });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "mcps", leaf: "atlassian", status: "ready" });
  });

  it("marks http transport unimportable", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { remote: { type: "http", url: "https://x" } } }),
    );
    const items = scanMcps({ root: tmp, ...G });
    expect(items[0]).toMatchObject({ status: "unimportable" });
    expect(items[0]?.reason).toMatch(/stdio/i);
  });

  it("marks missing command unimportable", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { broken: { type: "stdio" } } }),
    );
    expect(scanMcps({ root: tmp, ...G })[0]?.status).toBe("unimportable");
  });

  it("malformed .mcp.json yields one synthetic unimportable line", () => {
    writeFileSync(join(tmp, ".mcp.json"), "{ not json");
    const items = scanMcps({ root: tmp, ...G });
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("unimportable");
    expect(items[0]?.reason).toMatch(/JSON|Unexpected/i);
  });

  it("settings.json mcpServers also picked up", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, "settings.json"),
      JSON.stringify({ mcpServers: { fs: { command: "fs-mcp" } } }),
    );
    const items = scanMcps({ root: tmp, ...G });
    expect(items.map((i) => i.leaf)).toContain("fs");
  });

  it("empty mcpServers section → no items, no error", () => {
    writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({ mcpServers: null }));
    expect(scanMcps({ root: tmp, ...G })).toEqual([]);
  });

  it("no .mcp.json and no settings.json → empty", () => {
    expect(scanMcps({ root: tmp, ...G })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/importers/mcps.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/importers/mcps.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/importers/mcps.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/importers/mcps.ts test/unit/adopt/importers/mcps.test.ts
git commit -m "feat(adopt): MCP importer (stdio-only, .mcp.json + settings.json sources)"
```

---

## Task 9: Hooks importer (settings.json + plugin hooks.json)

**Files:**
- Create: `src/adopt/importers/hooks.ts`
- Test: `test/unit/adopt/importers/hooks.test.ts`

This is the trickiest importer. Per design:

- Parse `settings.json[hooks]` shape `{ [event]: [{ matcher, hooks: [{type:"command", command, …}] }] }`.
- Parse plugin `hooks/hooks.json` (same shape) when scanning a plugin root.
- Validation per hook entry: non-empty `event`, string `matcher`, non-empty `command`. Otherwise unimportable.
- Leaf naming:
  - Sidecar (`./<rel>` or `${CLAUDE_PLUGIN_ROOT}/hooks/<rel>`): basename without extension.
  - Inline: `<slug32>-<hash4>` (first 32 chars of slug + sha256 hash first 4 hex).
- Cross-dir `${CLAUDE_PLUGIN_ROOT}/lib/foo.sh` outside plugin's `hooks/`: best-effort — flag for write phase to copy at same relative path. If file missing under plugin root → `unimportable`.
- References outside plugin root (absolute, bare commands like `docker`): pass-through.

The scanner just classifies and stages enough context in `source: ImporterSource` (here `settings-hook`) for the write phase. Actual file copying happens in `write.ts`. To avoid over-coupling, the *importer* returns `AdoptableItem`s with a custom `source.entry` carrying the full hook config and the plugin-root path (when applicable).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/importers/hooks.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanHooks } from "../../../../src/adopt/importers/hooks.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-hooks-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const G = { originGroup: "g", originLabel: "G" };

describe("scanHooks — settings.json", () => {
  it("parses one hook entry per matcher × command tuple", () => {
    writeFileSync(
      join(tmp, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "echo hi" }],
            },
          ],
        },
      }),
    );
    const items = scanHooks({ root: tmp, ...G, mode: "direct" });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "hooks", status: "ready" });
  });

  it("invalid hook (missing matcher) → unimportable", () => {
    writeFileSync(
      join(tmp, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ hooks: [{ type: "command", command: "x" }] }],
        },
      }),
    );
    expect(scanHooks({ root: tmp, ...G, mode: "direct" })[0]?.status).toBe(
      "unimportable",
    );
  });

  it("inline command leaf = '<slug32>-<hash4>', deterministic across re-runs", () => {
    writeFileSync(
      join(tmp, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "*", hooks: [{ type: "command", command: "echo hello world" }] },
          ],
        },
      }),
    );
    const a = scanHooks({ root: tmp, ...G, mode: "direct" });
    const b = scanHooks({ root: tmp, ...G, mode: "direct" });
    expect(a[0]?.leaf).toBe(b[0]?.leaf);
    expect(a[0]?.leaf).toMatch(/^[a-z0-9-]+-[0-9a-f]{4}$/);
  });

  it("malformed settings.json → one synthetic unimportable line", () => {
    writeFileSync(join(tmp, "settings.json"), "{ malformed");
    const items = scanHooks({ root: tmp, ...G, mode: "direct" });
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("unimportable");
  });

  it("missing settings.json → empty (not an error)", () => {
    expect(scanHooks({ root: tmp, ...G, mode: "direct" })).toEqual([]);
  });

  it("hooks: null is not an error", () => {
    writeFileSync(join(tmp, "settings.json"), JSON.stringify({ hooks: null }));
    expect(scanHooks({ root: tmp, ...G, mode: "direct" })).toEqual([]);
  });
});

describe("scanHooks — plugin hooks/hooks.json", () => {
  it("sidecar leaf is basename without extension", () => {
    mkdirSync(join(tmp, "hooks"), { recursive: true });
    writeFileSync(join(tmp, "hooks", "log.sh"), "#!/bin/sh\n");
    writeFileSync(
      join(tmp, "hooks", "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" },
            ],
          },
        ],
      }),
    );
    const items = scanHooks({ root: tmp, ...G, mode: "plugin" });
    expect(items[0]?.leaf).toBe("log");
    expect(items[0]?.status).toBe("ready");
  });

  it("cross-dir reference present → flagged ready with crossDirRel staged in source", () => {
    mkdirSync(join(tmp, "hooks"), { recursive: true });
    mkdirSync(join(tmp, "lib"), { recursive: true });
    writeFileSync(join(tmp, "lib", "runner.sh"), "x\n");
    writeFileSync(
      join(tmp, "hooks", "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/lib/runner.sh" },
            ],
          },
        ],
      }),
    );
    const items = scanHooks({ root: tmp, ...G, mode: "plugin" });
    expect(items[0]?.status).toBe("ready");
    // The source carries enough to let write.ts copy lib/runner.sh
    expect((items[0]?.source as { entry?: unknown }).entry).toBeDefined();
  });

  it("cross-dir reference to missing file → unimportable", () => {
    mkdirSync(join(tmp, "hooks"), { recursive: true });
    writeFileSync(
      join(tmp, "hooks", "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/lib/ghost.sh" },
            ],
          },
        ],
      }),
    );
    const items = scanHooks({ root: tmp, ...G, mode: "plugin" });
    expect(items[0]?.status).toBe("unimportable");
    expect(items[0]?.reason).toMatch(/missing plugin file/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/importers/hooks.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/importers/hooks.ts`**

```ts
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { HookCommand } from "../../bundle/manifest.ts";
import type { AdoptableItem } from "../types.ts";

export interface HookScanOpts {
  root: string;
  originGroup: string;
  originLabel: string;
  mode: "direct" | "plugin";
}

export function scanHooks(opts: HookScanOpts): AdoptableItem[] {
  const out: AdoptableItem[] = [];
  if (opts.mode === "direct") {
    scanSettingsHooks(join(opts.root, "settings.json"), opts, out);
  } else {
    scanPluginHooks(opts.root, opts, out);
  }
  return out;
}

function scanSettingsHooks(path: string, opts: HookScanOpts, out: AdoptableItem[]): void {
  if (!existsSync(path)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    out.push(unimportable(opts, "settings", `${path}: ${(e as Error).message.split("\n", 1)[0]}`));
    return;
  }
  const hooks = (parsed as Record<string, unknown> | null)?.hooks;
  if (hooks === null || hooks === undefined) return;
  collectFromHooksObject(hooks, path, opts.root, opts, out, "direct");
}

function scanPluginHooks(pluginRoot: string, opts: HookScanOpts, out: AdoptableItem[]): void {
  const hjsonPath = join(pluginRoot, "hooks", "hooks.json");
  if (!existsSync(hjsonPath)) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(hjsonPath, "utf8"));
  } catch (e) {
    out.push(unimportable(opts, "settings", `${hjsonPath}: ${(e as Error).message.split("\n", 1)[0]}`));
    return;
  }
  collectFromHooksObject(parsed, hjsonPath, pluginRoot, opts, out, "plugin");
}

function collectFromHooksObject(
  raw: unknown,
  configPath: string,
  pluginRoot: string,
  opts: HookScanOpts,
  out: AdoptableItem[],
  scope: "direct" | "plugin",
): void {
  if (typeof raw !== "object" || raw === null) return;
  for (const [event, specsRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(specsRaw)) continue;
    for (const spec of specsRaw) {
      const s = spec as { matcher?: unknown; hooks?: unknown };
      const matcher = s.matcher;
      const entries = s.hooks;
      if (typeof matcher !== "string" || !Array.isArray(entries)) {
        out.push(unimportable(opts, "settings", `${configPath}: invalid hook spec under '${event}'`));
        continue;
      }
      for (const entry of entries) {
        out.push(buildItem(event, matcher, entry, configPath, pluginRoot, opts, scope));
      }
    }
  }
}

function buildItem(
  event: string,
  matcher: string,
  rawEntry: unknown,
  configPath: string,
  pluginRoot: string,
  opts: HookScanOpts,
  scope: "direct" | "plugin",
): AdoptableItem {
  const entry = (rawEntry ?? {}) as Record<string, unknown> & HookCommand;
  if (event.length === 0) return unimportable(opts, "settings", "empty 'event'");
  if (entry.type !== "command")
    return unimportable(opts, "settings", `${configPath}: hook 'type' must be 'command'`);
  const command = entry.command;
  if (typeof command !== "string" || command.length === 0) {
    return unimportable(opts, "settings", `${configPath}: hook missing 'command'`);
  }
  const classify = classifyCommand(command, pluginRoot, scope);
  if (classify.kind === "unimportable") {
    return unimportable(opts, "settings", classify.reason);
  }
  const leaf = classify.leaf;
  return {
    kind: "hooks",
    leaf,
    originGroup: opts.originGroup,
    originLabel: opts.originLabel,
    source: {
      type: "settings-hook",
      settingsPath: configPath,
      event,
      matcher,
      entry: { ...entry, command } as HookCommand,
      // crossDirRel + pluginRoot smuggled via index signature so write.ts can pick them up
      ...(classify.crossDirRel ? { crossDirRel: classify.crossDirRel } : {}),
      ...(classify.pluginRoot ? { pluginRoot: classify.pluginRoot } : {}),
    } as never,
    status: "ready",
  };
}

interface ClassifyResult {
  kind: "leaf";
  leaf: string;
  crossDirRel?: string;
  pluginRoot?: string;
}
interface ClassifyFail {
  kind: "unimportable";
  reason: string;
}

const PLUGIN_ROOT_PREFIX = "${CLAUDE_PLUGIN_ROOT}/";

function classifyCommand(
  command: string,
  pluginRoot: string,
  scope: "direct" | "plugin",
): ClassifyResult | ClassifyFail {
  const trimmed = command.trim();

  if (scope === "plugin" && trimmed.startsWith(PLUGIN_ROOT_PREFIX)) {
    const rel = trimmed.slice(PLUGIN_ROOT_PREFIX.length).split(/\s+/, 1)[0] ?? "";
    if (rel.startsWith("hooks/")) {
      const fileBase = basename(rel);
      return { kind: "leaf", leaf: stripExt(fileBase) };
    }
    const onDisk = join(pluginRoot, rel);
    if (!existsSync(onDisk)) {
      return {
        kind: "unimportable",
        reason: `command references missing plugin file ${rel}`,
      };
    }
    const fileBase = basename(rel);
    return { kind: "leaf", leaf: stripExt(fileBase), crossDirRel: rel, pluginRoot };
  }

  if (scope === "direct" && trimmed.startsWith("./")) {
    return {
      kind: "unimportable",
      reason: "command references path outside plugin root",
    };
  }

  // Inline command (anything else: bare 'docker …', absolute paths, etc.)
  return { kind: "leaf", leaf: inlineLeaf(command) };
}

function inlineLeaf(command: string): string {
  const slug32 = command
    .toLowerCase()
    .slice(0, 32)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const hash4 = createHash("sha256").update(command).digest("hex").slice(0, 4);
  const base = slug32.length > 0 ? slug32 : "hook";
  return `${base}-${hash4}`;
}

function stripExt(s: string): string {
  const ext = extname(s);
  return ext.length > 0 ? s.slice(0, -ext.length) : s;
}

function unimportable(opts: HookScanOpts, _tag: string, reason: string): AdoptableItem {
  return {
    kind: "hooks",
    leaf: inlineLeaf(reason),
    originGroup: opts.originGroup,
    originLabel: opts.originLabel,
    source: {
      type: "settings-hook",
      settingsPath: "",
      event: "",
      matcher: "",
      entry: { type: "command", command: "" },
    },
    status: "unimportable",
    reason,
  };
}
```

(The `as never` cast on `source` is intentional: we smuggle `crossDirRel` / `pluginRoot` via index signature in a way the type system can't currently express without expanding `ImporterSource`. If the team prefers, extend the discriminated union in task 2 instead — the cost is touching a typed-only file.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/importers/hooks.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/importers/hooks.ts test/unit/adopt/importers/hooks.test.ts
git commit -m "feat(adopt): hooks importer (settings.json + plugin hooks.json, sidecar/inline leaf naming)"
```

---

## Task 10: Plugin cache scanner

**Files:**
- Create: `src/adopt/importers/plugins.ts`
- Test: `test/unit/adopt/importers/plugins.test.ts`

Walks `<root>/plugins/cache/<marketplace>/<plugin>/<version>/`. Per design:
- For each plugin dir, look for `.claude-plugin/plugin.json`. Missing → 1 unimportable line per affected dir.
- For each *kept* version, dispatch to skills/agents/hooks/mcps importers against the plugin root.
- Surface `commands/` etc. as a single unimportable line per plugin (not per file).
- Multiple versions: enumerated; recommended-version selection (semver vs non-semver fallback) lives here as a pure function.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/importers/plugins.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listCachedPlugins,
  pickRecommendedVersion,
  scanPlugin,
} from "../../../../src/adopt/importers/plugins.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-plugins-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkPlugin(mkt: string, name: string, version: string, withIdentity = true): string {
  const root = join(tmp, "plugins", "cache", mkt, name, version);
  mkdirSync(root, { recursive: true });
  if (withIdentity) {
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(root, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name, version, description: "x" }),
    );
  }
  return root;
}

describe("listCachedPlugins", () => {
  it("groups versions per (marketplace, plugin)", () => {
    mkPlugin("mkt", "p1", "1.0.0");
    mkPlugin("mkt", "p1", "1.1.0");
    mkPlugin("mkt", "p2", "0.1.0");
    const groups = listCachedPlugins(join(tmp, "plugins", "cache"));
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.plugin === "p1")?.versions).toEqual(["1.0.0", "1.1.0"]);
  });

  it("missing cache root → empty", () => {
    expect(listCachedPlugins(join(tmp, "nope"))).toEqual([]);
  });
});

describe("pickRecommendedVersion", () => {
  it("returns highest by semver when all semver-valid", () => {
    expect(pickRecommendedVersion(["1.0.0", "1.1.0", "0.9.0"])).toBe("1.1.0");
  });

  it("returns null when any version fails semver", () => {
    expect(pickRecommendedVersion(["1.0.0", "abc123"])).toBeNull();
  });
});

describe("scanPlugin", () => {
  it("missing .claude-plugin/plugin.json → one synthetic unimportable", () => {
    const root = mkPlugin("mkt", "broken", "1.0.0", false);
    const r = scanPlugin(root, { marketplace: "mkt", plugin: "broken", version: "1.0.0" });
    expect(r.unimportable).toHaveLength(1);
    expect(r.unimportable[0]?.reason).toMatch(/missing \.claude-plugin\/plugin\.json/);
    expect(r.importable).toEqual([]);
  });

  it("surfaces commands/ as single unimportable line (not per-file)", () => {
    const root = mkPlugin("mkt", "p", "1.0.0");
    mkdirSync(join(root, "commands"), { recursive: true });
    writeFileSync(join(root, "commands", "a.md"), "x");
    writeFileSync(join(root, "commands", "b.md"), "y");
    const r = scanPlugin(root, { marketplace: "mkt", plugin: "p", version: "1.0.0" });
    const cmds = r.unimportable.filter((i) => /slash commands/i.test(i.reason ?? ""));
    expect(cmds).toHaveLength(1);
  });

  it("dispatches to skills/agents/hooks/mcps importers", () => {
    const root = mkPlugin("mkt", "p", "1.0.0");
    mkdirSync(join(root, "skills", "demo"), { recursive: true });
    writeFileSync(join(root, "skills", "demo", "SKILL.md"), "---\nname: demo\n---\n");
    const r = scanPlugin(root, { marketplace: "mkt", plugin: "p", version: "1.0.0" });
    expect(r.importable.find((i) => i.kind === "skills" && i.leaf === "demo")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/importers/plugins.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/importers/plugins.ts`**

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import semver from "semver";
import type { AdoptableItem } from "../types.ts";
import { scanAgents } from "./agents.ts";
import { scanHooks } from "./hooks.ts";
import { scanMcps } from "./mcps.ts";
import { scanSkills } from "./skills.ts";

export interface PluginIdentity {
  marketplace: string;
  plugin: string;
  version: string;
}

export interface PluginGroup {
  marketplace: string;
  plugin: string;
  versions: string[];
  rootByVersion: Record<string, string>;
}

export interface PluginScanResult {
  importable: AdoptableItem[];
  unimportable: AdoptableItem[];
}

export function listCachedPlugins(cacheRoot: string): PluginGroup[] {
  if (!safeIsDir(cacheRoot)) return [];
  const out: PluginGroup[] = [];
  for (const mktName of safeListDirs(cacheRoot)) {
    const mktDir = join(cacheRoot, mktName);
    for (const pluginName of safeListDirs(mktDir)) {
      const pluginDir = join(mktDir, pluginName);
      const versions = safeListDirs(pluginDir).sort();
      if (versions.length === 0) continue;
      const rootByVersion: Record<string, string> = {};
      for (const v of versions) rootByVersion[v] = join(pluginDir, v);
      out.push({ marketplace: mktName, plugin: pluginName, versions, rootByVersion });
    }
  }
  return out;
}

export function pickRecommendedVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  if (!versions.every((v) => semver.valid(v) !== null)) return null;
  return [...versions].sort(semver.compare).pop() ?? null;
}

const GROUP_LABEL_VERSION_SUFFIX = "@";

export function scanPlugin(root: string, ident: PluginIdentity): PluginScanResult {
  const importable: AdoptableItem[] = [];
  const unimportable: AdoptableItem[] = [];

  const identityFile = join(root, ".claude-plugin", "plugin.json");
  if (!existsSync(identityFile)) {
    unimportable.push({
      kind: "skills",
      leaf: `${ident.marketplace}-${ident.plugin}-${ident.version}`,
      originGroup: groupSlug(ident),
      originLabel: groupLabel(ident),
      source: { type: "dir", path: root },
      status: "unimportable",
      reason: `cache/${ident.marketplace}/${ident.plugin}/${ident.version} — missing .claude-plugin/plugin.json (likely partial install)`,
    });
    return { importable, unimportable };
  }
  try {
    JSON.parse(readFileSync(identityFile, "utf8"));
  } catch (e) {
    unimportable.push({
      kind: "skills",
      leaf: `${ident.marketplace}-${ident.plugin}-${ident.version}`,
      originGroup: groupSlug(ident),
      originLabel: groupLabel(ident),
      source: { type: "dir", path: root },
      status: "unimportable",
      reason: `cache/${ident.marketplace}/${ident.plugin}/${ident.version} — malformed plugin.json: ${(e as Error).message.split("\n", 1)[0]}`,
    });
    return { importable, unimportable };
  }

  const opts = { root, originGroup: groupSlug(ident), originLabel: groupLabel(ident) };
  collect(scanSkills(opts), importable, unimportable);
  collect(scanAgents(opts), importable, unimportable);
  collect(scanHooks({ ...opts, mode: "plugin" }), importable, unimportable);
  collect(scanMcps(opts), importable, unimportable);

  if (safeIsDir(join(root, "commands"))) {
    unimportable.push({
      kind: "skills",
      leaf: `${ident.plugin}-commands`,
      originGroup: groupSlug(ident),
      originLabel: groupLabel(ident),
      source: { type: "dir", path: join(root, "commands") },
      status: "unimportable",
      reason: "Claude Code slash commands (not modeled by umbel)",
    });
  }

  return { importable, unimportable };
}

function groupSlug(id: PluginIdentity): string {
  return `${id.marketplace}-${id.plugin}${GROUP_LABEL_VERSION_SUFFIX}${id.version}`;
}
function groupLabel(id: PluginIdentity): string {
  return `${id.marketplace}/${id.plugin}@${id.version}`;
}

function collect(items: AdoptableItem[], imp: AdoptableItem[], unimp: AdoptableItem[]): void {
  for (const it of items) {
    if (it.status === "unimportable") unimp.push(it);
    else imp.push(it);
  }
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeListDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}
```

If `semver` is not already a dependency, add it: run `npm i semver && npm i -D @types/semver`. (Verify in `package.json` before adding.)

- [ ] **Step 4: Verify semver dependency**

Run: `node -e 'console.log(Object.keys(require("./package.json").dependencies||{}).includes("semver"))'`
Expected: `true`. If `false`, run: `npm i semver && npm i -D @types/semver`. Commit `package.json` + `package-lock.json` alongside the importer.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/unit/adopt/importers/plugins.test.ts && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/adopt/importers/plugins.ts test/unit/adopt/importers/plugins.test.ts package.json package-lock.json
git commit -m "feat(adopt): plugin cache scanner + recommended-version (semver-strict)"
```

---

## Task 11: Scan orchestrator

**Files:**
- Create: `src/adopt/scan.ts`
- Test: `test/unit/adopt/scan.test.ts`

Composes origin + direct importers + plugin scanner into a single `ScanReport`. Marks items as `already-imported` if `$UMBEL_ARTIFACTS_DIR/<kind>/<source>/<leaf>/` already exists. Accepts `pluginVersionByPlugin: Record<groupKey, version>` to pre-filter plugins after the conditional version pre-picker.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/scan.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scan } from "../../../src/adopt/scan.ts";
import type { ResolvedOrigin } from "../../../src/adopt/types.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-scan-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkSkill(root: string, leaf: string): void {
  const dir = join(root, "skills", leaf);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${leaf}\n---\n`);
}

describe("scan", () => {
  it("aggregates direct + plugin items into ScanReport", () => {
    const home = join(tmp, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkSkill(join(home, ".claude"), "direct-skill");
    const pluginRoot = join(home, ".claude", "plugins", "cache", "mkt", "p", "1.0.0");
    mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
    writeFileSync(
      join(pluginRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "p", version: "1.0.0" }),
    );
    mkSkill(pluginRoot, "plugin-skill");

    const origin: ResolvedOrigin = { kind: "global", root: join(home, ".claude") };
    const artifactRoot = join(tmp, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });

    const report = scan(origin, { artifactRoot, sourceName: "claude" });
    const leaves = report.importable.map((i) => i.leaf).sort();
    expect(leaves).toContain("direct-skill");
    expect(leaves).toContain("plugin-skill");
  });

  it("marks already-imported items when target dir exists", () => {
    const home = join(tmp, "home");
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkSkill(join(home, ".claude"), "existing");

    const artifactRoot = join(tmp, "artifacts");
    mkdirSync(join(artifactRoot, "skills", "claude", "existing"), { recursive: true });

    const origin: ResolvedOrigin = { kind: "global", root: join(home, ".claude") };
    const report = scan(origin, { artifactRoot, sourceName: "claude" });
    const existing = report.importable.find((i) => i.leaf === "existing");
    expect(existing?.status).toBe("already-imported");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/scan.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/scan.ts`**

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanAgents } from "./importers/agents.ts";
import { scanHooks } from "./importers/hooks.ts";
import { scanMcps } from "./importers/mcps.ts";
import {
  type PluginGroup,
  listCachedPlugins,
  scanPlugin,
} from "./importers/plugins.ts";
import { scanSkills } from "./importers/skills.ts";
import type { AdoptableItem, ResolvedOrigin, ScanReport } from "./types.ts";

export interface ScanOpts {
  artifactRoot: string;
  sourceName: string;
  pluginVersionByGroup?: Record<string, string>;
}

export function scan(origin: ResolvedOrigin, opts: ScanOpts): ScanReport {
  const importable: AdoptableItem[] = [];
  const unimportable: AdoptableItem[] = [];

  if (origin.kind === "global" || origin.kind === "project") {
    const directGroup =
      origin.kind === "global"
        ? { originGroup: "claude", originLabel: "claude (global ~/.claude)" }
        : { originGroup: opts.sourceName, originLabel: `${origin.root}` };
    collect(scanSkills({ root: origin.root, ...directGroup }));
    collect(scanAgents({ root: origin.root, ...directGroup }));
    collect(scanHooks({ root: origin.root, mode: "direct", ...directGroup }));
    collect(scanMcps({ root: origin.root, ...directGroup }));

    if (origin.kind === "global") {
      collectPlugins(join(origin.root, "plugins", "cache"));
    }
  }

  for (const it of importable) {
    if (it.status === "ready" && isAlreadyImported(it, opts)) {
      it.status = "already-imported";
    }
  }

  return { origin, importable, unimportable };

  function collect(items: AdoptableItem[]): void {
    for (const it of items) {
      if (it.status === "unimportable") unimportable.push(it);
      else importable.push(it);
    }
  }

  function collectPlugins(cacheRoot: string): void {
    const groups = listCachedPlugins(cacheRoot);
    for (const g of groups) {
      const version = pickVersion(g, opts);
      if (version === null) continue;
      const root = g.rootByVersion[version];
      if (root === undefined) continue;
      const result = scanPlugin(root, {
        marketplace: g.marketplace,
        plugin: g.plugin,
        version,
      });
      for (const it of result.importable) importable.push(it);
      for (const it of result.unimportable) unimportable.push(it);
    }
  }
}

function pickVersion(g: PluginGroup, opts: ScanOpts): string | null {
  const key = `${g.marketplace}-${g.plugin}`;
  const chosen = opts.pluginVersionByGroup?.[key];
  if (chosen !== undefined) return chosen;
  if (g.versions.length === 1) return g.versions[0] ?? null;
  // Caller must run the pre-picker; the orchestrator alone has no UI.
  // For non-interactive scan paths (--dry-run TTY guard handles this elsewhere)
  // we conservatively skip multi-version plugins; the wizard will fill in
  // pluginVersionByGroup and re-scan.
  return null;
}

function isAlreadyImported(item: AdoptableItem, opts: ScanOpts): boolean {
  const targetDir = join(opts.artifactRoot, item.kind, opts.sourceName, item.leaf);
  return existsSync(targetDir);
}
```

Note: `scan` is callable twice — once before the version pre-picker (to compute `PluginGroup`s with `versions.length > 1` so the wizard can prompt), once after with `pluginVersionByGroup` populated. The version-listing API doubles as the "do I need to ask?" check.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/scan.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/scan.ts test/unit/adopt/scan.test.ts
git commit -m "feat(adopt): scan orchestrator (direct + plugin importers, already-imported detection)"
```

---

## Task 12: Plan builder

**Files:**
- Create: `src/adopt/plan.ts`
- Test: `test/unit/adopt/plan.test.ts`

Turns selected `AdoptableItem`s + the source-name choice into an `ImportPlan` whose `writes` enumerate exactly the files the writer will produce. Pure (no fs writes). Per-kind shape mirrors what `compile.ts:emitHooks` / `emitMcps` expect.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/plan.test.ts
import { describe, expect, it } from "vitest";
import { buildPlan } from "../../../src/adopt/plan.ts";
import type { AdoptableItem, ResolvedOrigin } from "../../../src/adopt/types.ts";

const ORIGIN: ResolvedOrigin = { kind: "global", root: "/home/.claude" };

function readyDir(kind: AdoptableItem["kind"], leaf: string, src: string): AdoptableItem {
  return {
    kind,
    leaf,
    originGroup: "claude",
    originLabel: "claude",
    source: { type: "dir", path: src },
    status: "ready",
  };
}

describe("buildPlan", () => {
  it("emits a copy write for skills/agents", () => {
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [readyDir("skills", "x", "/abs/x")],
      artifactRoot: "/art",
    });
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]?.writes[0]?.targetDir).toBe("/art/skills/claude/x");
    expect(plan.items[0]?.writes[0]?.files[0]?.from.kind).toBe("copy");
  });

  it("synthesizes HOOK.md for settings-hook source", () => {
    const item: AdoptableItem = {
      kind: "hooks",
      leaf: "log",
      originGroup: "claude",
      originLabel: "claude",
      source: {
        type: "settings-hook",
        settingsPath: "/x/settings.json",
        event: "PreToolUse",
        matcher: "Bash",
        entry: { type: "command", command: "echo hi" },
      },
      status: "ready",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot: "/art",
    });
    const write = plan.items[0]?.writes[0];
    expect(write?.targetDir).toBe("/art/hooks/claude/log");
    const hookMd = write?.files.find((f) => f.relPath === "HOOK.md");
    expect(hookMd?.from.kind).toBe("content");
    expect((hookMd?.from as { data: string }).data).toMatch(/event: PreToolUse/);
    expect((hookMd?.from as { data: string }).data).toMatch(/matcher: Bash/);
    expect((hookMd?.from as { data: string }).data).toMatch(/command: echo hi/);
  });

  it("synthesizes MCP.md for mcp-json source", () => {
    const item: AdoptableItem = {
      kind: "mcps",
      leaf: "atlassian",
      originGroup: "claude",
      originLabel: "claude",
      source: {
        type: "mcp-json",
        jsonPath: "/x/.mcp.json",
        serverName: "atlassian",
        config: { command: "uvx", args: ["atlassian-mcp"] },
      },
      status: "ready",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot: "/art",
    });
    const mcpMd = plan.items[0]?.writes[0]?.files.find((f) => f.relPath === "MCP.md");
    expect((mcpMd?.from as { data: string }).data).toMatch(/command: uvx/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/plan.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/plan.ts`**

```ts
import { dirname, join } from "node:path";
import type {
  AdoptableItem,
  ImportPlan,
  ImportPlanItem,
  PlannedWrite,
  ResolvedOrigin,
} from "./types.ts";

export interface PlanOpts {
  origin: ResolvedOrigin;
  defaultSourceName: string;
  selected: AdoptableItem[];
  artifactRoot: string;
}

export function buildPlan(opts: PlanOpts): ImportPlan {
  const items: ImportPlanItem[] = opts.selected.map((item) => {
    const sourceName = sourceNameFor(item, opts);
    const targetDir = join(opts.artifactRoot, item.kind, sourceName, item.leaf);
    const writes: PlannedWrite[] = [planWrite(item, targetDir)];
    return { item, sourceName, writes };
  });
  return {
    origin: opts.origin,
    defaultSourceName: opts.defaultSourceName,
    items,
  };
}

function sourceNameFor(item: AdoptableItem, opts: PlanOpts): string {
  // Plugin items embed `<mkt>-<plugin>@<version>` in originGroup.
  // Strip the @<version> suffix for the version-agnostic source bucket.
  const g = item.originGroup;
  const at = g.indexOf("@");
  if (at >= 0) return `cc-plugin-${g.slice(0, at)}`;
  return opts.defaultSourceName;
}

function planWrite(item: AdoptableItem, targetDir: string): PlannedWrite {
  if (item.source.type === "dir") {
    return {
      targetDir,
      files: [{ relPath: ".", from: { kind: "copy", src: item.source.path } }],
    };
  }
  if (item.source.type === "settings-hook") {
    const extra = item.source as unknown as {
      crossDirRel?: string;
      pluginRoot?: string;
    };
    const files: PlannedWrite["files"] = [
      { relPath: "HOOK.md", from: { kind: "content", data: renderHookMd(item) } },
    ];
    if (extra.crossDirRel && extra.pluginRoot) {
      files.push({
        relPath: extra.crossDirRel,
        from: { kind: "copy", src: join(extra.pluginRoot, extra.crossDirRel) },
      });
    }
    // The whole plugin <plugin>/hooks/ directory copy (per design's plugin-hooks
    // case) is appended by the writer when it detects `entry.command` references
    // a same-dir sidecar. Keeping that fan-out in the writer rather than here
    // lets the planner stay pure: it deals only in explicit content + copy ops.
    return { targetDir, files };
  }
  if (item.source.type === "mcp-json") {
    return {
      targetDir,
      files: [{ relPath: "MCP.md", from: { kind: "content", data: renderMcpMd(item) } }],
    };
  }
  return { targetDir, files: [] };
}

function renderHookMd(item: AdoptableItem): string {
  if (item.source.type !== "settings-hook") return "";
  const s = item.source;
  const passThrough: Record<string, unknown> = { ...s.entry };
  delete passThrough.type;
  delete passThrough.command;
  const lines = ["---", `name: ${item.leaf}`, `event: ${s.event}`, `matcher: ${s.matcher}`, `command: ${rewriteCommand(s.entry.command, item)}`];
  for (const [k, v] of Object.entries(passThrough)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function renderMcpMd(item: AdoptableItem): string {
  if (item.source.type !== "mcp-json") return "";
  const cfg = item.source.config;
  const passThrough: Record<string, unknown> = { ...cfg };
  delete passThrough.command;
  delete passThrough.type;
  const lines = ["---", `name: ${item.leaf}`, `command: ${cfg.command}`];
  for (const [k, v] of Object.entries(passThrough)) {
    lines.push(`${k}: ${JSON.stringify(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function rewriteCommand(command: string, item: AdoptableItem): string {
  const trimmed = command.trim();
  const prefix = "${CLAUDE_PLUGIN_ROOT}/";
  if (trimmed.startsWith(prefix)) {
    const rel = trimmed.slice(prefix.length);
    // hooks/<file>... → ./<file>...
    if (rel.startsWith("hooks/")) return `./${rel.slice("hooks/".length)}`;
    return `./${rel}`;
  }
  return command;
}
```

The planner is intentionally light on the plugin-hooks fan-out; the writer (next task) handles "copy the whole `<plugin>/hooks/` dir" because that involves filesystem inspection and the planner stays pure.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/plan.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/plan.ts test/unit/adopt/plan.test.ts
git commit -m "feat(adopt): pure plan builder (writes mapped per item kind)"
```

---

## Task 13: Writer

**Files:**
- Create: `src/adopt/write.ts`
- Test: `test/unit/adopt/write.test.ts`

Materialise an `ImportPlan` onto disk:
- For each item, `mkdirSync(targetDir, { recursive: true })`.
- For each file in the write:
  - `kind: "copy"` + `relPath === "."` → `cpSync(src, targetDir, { recursive: true, dereference: true })` (mirrors `compile.ts:emitHooks`).
  - `kind: "copy"` + non-`"."` → copy individual file at `relPath` under `targetDir`.
  - `kind: "content"` → `writeFileSync(join(targetDir, relPath), data)`.
- For settings-hook items (plugin scope), if the entry source carries a sidecar reference, copy the whole `<plugin>/hooks/` dir into `targetDir` *before* writing HOOK.md (so sidecars travel with the hook). For direct-scope hooks, no extra copy.
- After every item succeeds, append `{ kind, leaf }` to the metadata accumulator. After all items, call `writeMeta(artifactRoot, { source, lastAdoptedAt: ISO, origin: …, items })` once.
- Partial-failure semantics: on a per-item exception, abort the loop, write the metadata for *successfully* written items (so subsequent `--refresh` can still clean up partials), then rethrow as `ApplyError("wrote N of M before failure: <list>")`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/write.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPlan } from "../../../src/adopt/plan.ts";
import { writePlan } from "../../../src/adopt/write.ts";
import type { AdoptableItem, ResolvedOrigin } from "../../../src/adopt/types.ts";
import { readMeta } from "../../../src/adopt/meta.ts";

let tmp: string;
let artifactRoot: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-write-"));
  artifactRoot = join(tmp, "artifacts");
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const ORIGIN: ResolvedOrigin = { kind: "global", root: "/anywhere/.claude" };

function mkSkillDir(name: string): string {
  const dir = join(tmp, "src", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\nbody\n`);
  return dir;
}

describe("writePlan", () => {
  it("materializes a skill copy and writes adopt metadata", () => {
    const srcDir = mkSkillDir("brainstorming");
    const item: AdoptableItem = {
      kind: "skills",
      leaf: "brainstorming",
      originGroup: "claude",
      originLabel: "claude",
      source: { type: "dir", path: srcDir },
      status: "ready",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot,
    });
    writePlan(plan, { artifactRoot });
    expect(existsSync(join(artifactRoot, "skills", "claude", "brainstorming", "SKILL.md"))).toBe(
      true,
    );
    const meta = readMeta(artifactRoot, "claude");
    expect(meta.items).toEqual([{ kind: "skills", leaf: "brainstorming" }]);
    expect(meta.origin).toEqual({ type: "global" });
  });

  it("hook with same-dir sidecar copies the whole hooks/ dir + writes HOOK.md", () => {
    const pluginRoot = join(tmp, "plugins", "p", "1.0.0");
    mkdirSync(join(pluginRoot, "hooks"), { recursive: true });
    writeFileSync(join(pluginRoot, "hooks", "log.sh"), "#!/bin/sh\necho\n");
    writeFileSync(
      join(pluginRoot, "hooks", "hooks.json"),
      JSON.stringify({
        PreToolUse: [
          { matcher: "*", hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" }] },
        ],
      }),
    );
    const item: AdoptableItem = {
      kind: "hooks",
      leaf: "log",
      originGroup: "mkt-p@1.0.0",
      originLabel: "mkt/p@1.0.0",
      source: {
        type: "settings-hook",
        settingsPath: join(pluginRoot, "hooks", "hooks.json"),
        event: "PreToolUse",
        matcher: "*",
        entry: { type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" },
        // smuggled by importer
        pluginRoot,
        sidecarsDir: join(pluginRoot, "hooks"),
      } as never,
      status: "ready",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot,
    });
    writePlan(plan, { artifactRoot });
    const target = join(artifactRoot, "hooks", "cc-plugin-mkt-p", "log");
    expect(existsSync(join(target, "HOOK.md"))).toBe(true);
    expect(existsSync(join(target, "log.sh"))).toBe(true);
    const hookMd = readFileSync(join(target, "HOOK.md"), "utf8");
    expect(hookMd).toMatch(/command: \.\/log\.sh/);
  });

  it("idempotent on already-imported items (status filter)", () => {
    const srcDir = mkSkillDir("x");
    const item: AdoptableItem = {
      kind: "skills",
      leaf: "x",
      originGroup: "claude",
      originLabel: "claude",
      source: { type: "dir", path: srcDir },
      status: "already-imported",
    };
    const plan = buildPlan({
      origin: ORIGIN,
      defaultSourceName: "claude",
      selected: [item],
      artifactRoot,
    });
    writePlan(plan, { artifactRoot });
    // Already-imported items are skipped, so meta should be empty.
    const meta = readMeta(artifactRoot, "claude");
    expect(meta.items).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/write.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/write.ts`**

Update task 9's hook importer to also smuggle `sidecarsDir: join(pluginRoot, "hooks")` onto plugin-mode entries (it already smuggles `pluginRoot`; this is one extra line in `buildItem` when `scope === "plugin"`). If that change is missed during task 9, add it here as part of this task's commit.

```ts
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ApplyError } from "../errors.ts";
import type { ArtifactKind } from "../bundle/kinds.ts";
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
```

If task 9's hook importer doesn't already smuggle `sidecarsDir`, patch `src/adopt/importers/hooks.ts:classifyCommand` to return `sidecarsDir: join(pluginRoot, "hooks")` for the sidecar branch, and merge it onto the source object in `buildItem`. Include that one-line addition in this task's commit.

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/write.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/write.ts test/unit/adopt/write.test.ts src/adopt/importers/hooks.ts
git commit -m "feat(adopt): writer materializes plan + .adopt-meta sidecar"
```

---

## Task 14: Refresh flow

**Files:**
- Create: `src/adopt/refresh.ts`
- Test: `test/unit/adopt/refresh.test.ts`

Reads metadata, deletes only adopt-managed leafs from disk, returns a `ResolvedOrigin` so the caller can re-enter the wizard. Hand-rolled siblings in the same source bucket are preserved.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/refresh.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaPath, writeMeta } from "../../../src/adopt/meta.ts";
import { planRefresh, executeRefresh } from "../../../src/adopt/refresh.ts";
import { NotFoundError } from "../../../src/errors.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-refresh-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("refresh", () => {
  it("planRefresh lists items in metadata and detects hand-rolled siblings", () => {
    mkdirSync(join(tmp, "skills", "claude", "managed"), { recursive: true });
    mkdirSync(join(tmp, "skills", "claude", "handrolled"), { recursive: true });
    writeMeta(tmp, {
      source: "claude",
      lastAdoptedAt: "2026-01-01T00:00:00Z",
      origin: { type: "global" },
      items: [{ kind: "skills", leaf: "managed" }],
    });
    const p = planRefresh(tmp, "claude");
    expect(p.toDelete).toEqual([{ kind: "skills", leaf: "managed" }]);
    expect(p.handRolledSiblings).toEqual([{ kind: "skills", leaf: "handrolled" }]);
  });

  it("missing metadata → NotFoundError", () => {
    expect(() => planRefresh(tmp, "claude")).toThrow(NotFoundError);
  });

  it("executeRefresh deletes listed items, preserves hand-rolled ones, soft-skips missing", () => {
    mkdirSync(join(tmp, "skills", "claude", "managed"), { recursive: true });
    mkdirSync(join(tmp, "skills", "claude", "handrolled"), { recursive: true });
    writeMeta(tmp, {
      source: "claude",
      lastAdoptedAt: "2026-01-01T00:00:00Z",
      origin: { type: "global" },
      items: [
        { kind: "skills", leaf: "managed" },
        { kind: "skills", leaf: "gone-already" }, // not on disk
      ],
    });
    executeRefresh(tmp, "claude");
    expect(existsSync(join(tmp, "skills", "claude", "managed"))).toBe(false);
    expect(existsSync(join(tmp, "skills", "claude", "handrolled"))).toBe(true);
    // Metadata file itself is removed; refresh re-writes it after successful re-import.
    expect(existsSync(metaPath(tmp, "claude"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/refresh.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/refresh.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/refresh.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/refresh.ts test/unit/adopt/refresh.test.ts
git commit -m "feat(adopt): --refresh flow (plan + execute, preserves hand-rolled siblings)"
```

---

## Task 15: Path-prompt validator

**Files:**
- Create: `src/ui/path-prompt.ts`
- Test: `test/unit/adopt/path-prompt.test.ts`

The actual `text()` clack call lives in the wizard (task 17). Only the validator function is unit-tested here.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/path-prompt.test.ts
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandHomePath, validateClaudeProjectPath } from "../../../src/ui/path-prompt.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-pp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("expandHomePath", () => {
  it("expands ~ and ~/foo", () => {
    expect(expandHomePath("~", "/home/u")).toBe("/home/u");
    expect(expandHomePath("~/foo", "/home/u")).toBe("/home/u/foo");
  });
  it("passes through absolute path", () => {
    expect(expandHomePath("/abs/path", "/home/u")).toBe("/abs/path");
  });
});

describe("validateClaudeProjectPath", () => {
  it("returns undefined when path exists and has .claude/", () => {
    const proj = join(tmp, "good");
    mkdirSync(join(proj, ".claude"), { recursive: true });
    expect(validateClaudeProjectPath(proj, { home: tmp })).toBeUndefined();
  });
  it("returns error string when path missing", () => {
    expect(typeof validateClaudeProjectPath(join(tmp, "nope"), { home: tmp })).toBe(
      "string",
    );
  });
  it("returns error string when path lacks .claude/", () => {
    const proj = join(tmp, "naked");
    mkdirSync(proj, { recursive: true });
    expect(typeof validateClaudeProjectPath(proj, { home: tmp })).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/path-prompt.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/ui/path-prompt.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/path-prompt.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/path-prompt.ts test/unit/adopt/path-prompt.test.ts
git commit -m "feat(adopt): path-prompt validator (existence + .claude/ guard)"
```

---

## Task 16: Picker group builder

**Files:**
- Create: `src/adopt/picker.ts`
- Test: `test/unit/adopt/picker.test.ts`

Pure helper: turn a `ScanReport` + an `ArtifactKind` into `Record<groupKey, GroupedOption<AdoptableItem>[]>` consumable by `pickGrouped`. Applies pruning rules (skip kinds with zero / all-unimportable items).

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/adopt/picker.test.ts
import { describe, expect, it } from "vitest";
import { buildAdoptPickerGroups, hasAnyReady } from "../../../src/adopt/picker.ts";
import type { AdoptableItem } from "../../../src/adopt/types.ts";

function it_(kind: AdoptableItem["kind"], leaf: string, status: AdoptableItem["status"], grp = "claude"): AdoptableItem {
  return {
    kind,
    leaf,
    originGroup: grp,
    originLabel: grp,
    source: { type: "dir", path: "/x" },
    status,
  };
}

describe("buildAdoptPickerGroups", () => {
  it("groups by originGroup with disabled flag for non-ready items", () => {
    const items = [
      it_("skills", "a", "ready"),
      it_("skills", "b", "already-imported"),
      it_("skills", "c", "unimportable", "claude"),
    ];
    const groups = buildAdoptPickerGroups(items, "skills");
    expect(Object.keys(groups)).toEqual(["claude"]);
    expect(groups.claude.map((o) => o.value.leaf)).toEqual(["a", "b", "c"]);
    expect(groups.claude.find((o) => o.value.leaf === "b")?.disabled).toBe(true);
    expect(groups.claude.find((o) => o.value.leaf === "c")?.disabled).toBe(true);
  });

  it("filters by kind", () => {
    const items = [
      it_("skills", "s1", "ready"),
      it_("agents", "a1", "ready"),
    ];
    expect(Object.values(buildAdoptPickerGroups(items, "agents")).flat()).toHaveLength(1);
  });
});

describe("hasAnyReady", () => {
  it("true when any item is ready", () => {
    expect(hasAnyReady([it_("skills", "a", "ready")])).toBe(true);
  });
  it("false when every item is non-ready", () => {
    expect(hasAnyReady([it_("skills", "a", "already-imported"), it_("skills", "b", "unimportable")])).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/picker.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/picker.ts`**

```ts
import type { ArtifactKind } from "../bundle/kinds.ts";
import type { GroupedOption } from "../ui/picker.ts";
import type { AdoptableItem } from "./types.ts";

export function buildAdoptPickerGroups(
  items: AdoptableItem[],
  kind: ArtifactKind,
): Record<string, GroupedOption<AdoptableItem>[]> {
  const groups: Record<string, GroupedOption<AdoptableItem>[]> = {};
  for (const it of items) {
    if (it.kind !== kind) continue;
    const opt: GroupedOption<AdoptableItem> = {
      value: it,
      label: renderLabel(it),
    };
    if (it.status === "already-imported") {
      opt.disabled = true;
      opt.hint = "already imported";
    } else if (it.status === "unimportable") {
      opt.disabled = true;
      opt.hint = it.reason ?? "cannot import";
    }
    groups[it.originGroup] ??= [];
    groups[it.originGroup].push(opt);
  }
  return groups;
}

export function hasAnyReady(items: AdoptableItem[]): boolean {
  return items.some((i) => i.status === "ready");
}

function renderLabel(it: AdoptableItem): string {
  if (it.status === "ready") return it.leaf;
  if (it.status === "already-imported") return `${it.leaf}  [already imported]`;
  return `${it.leaf}  [× ${it.reason ?? "cannot import"}]`;
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run test/unit/adopt/picker.test.ts && npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/adopt/picker.ts test/unit/adopt/picker.test.ts
git commit -m "feat(adopt): picker group builder + ready/unimportable disambiguation"
```

---

## Task 17: Wizard composition

**Files:**
- Create: `src/ui/adopt-wizard.ts`

The interactive shell that stitches steps [1]–[5]. Not unit-tested (TTY-only; same posture as `bundle-init.ts`). Calls `runInitWizard` from `bundle-init.ts` at the hand-off (init runs **unmodified** per design AC).

Output the scan-report block + per-category pickers + the final write summary. Mirrors the layout in `docs/adopt-design.md` step [2]–[5] verbatim where possible.

- [ ] **Step 1: Skim `src/ui/bundle-init.ts` for clack conventions**

Read it — note the `assertSelected(...)` pattern around clack prompt results and the imports from `@clack/prompts`. The wizard should follow the same posture: import `select`, `multiselect`, `text`, `confirm`, `note`, `outro` from `@clack/prompts`, wrap every prompt in `assertSelected`, and treat user cancel (Ctrl-C → `CancelledError`) as a normal exit code 130. The harness in `src/cli.ts` already maps `CancelledError`.

- [ ] **Step 2: Create `src/ui/adopt-wizard.ts`**

```ts
import { confirm, multiselect, note, select, text } from "@clack/prompts";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { UsageError } from "../errors.ts";
import { defaultSourceNameFor, resolveOrigin } from "../adopt/origin.ts";
import { buildAdoptPickerGroups, hasAnyReady } from "../adopt/picker.ts";
import { buildPlan } from "../adopt/plan.ts";
import { scan } from "../adopt/scan.ts";
import { listCachedPlugins, pickRecommendedVersion } from "../adopt/importers/plugins.ts";
import { writePlan } from "../adopt/write.ts";
import type { AdoptableItem, ResolvedOrigin } from "../adopt/types.ts";
import { isValidSlug, slugify } from "../adopt/slug.ts";
import { pickGrouped } from "./picker.ts";
import { assertSelected } from "./prompt.ts";
import { expandHomePath, validateClaudeProjectPath } from "./path-prompt.ts";

export interface AdoptWizardCtx {
  cwd: string;
  home: string;
  artifactRoot: string;
  dryRun: boolean;
  refreshOrigin?: ResolvedOrigin;
}

export async function runAdoptWizard(ctx: AdoptWizardCtx): Promise<number> {
  const origin = await chooseOrigin(ctx);
  const versionByGroup = await maybePickPluginVersions(origin, ctx);
  const sourceName = await chooseSourceName(origin);
  const report = scan(origin, {
    artifactRoot: ctx.artifactRoot,
    sourceName,
    pluginVersionByGroup: versionByGroup,
  });
  emitReport(report);

  if (!hasAnyReadyAnywhere(report.importable)) {
    note("Nothing to import from this origin. (See report above for unimportable items.)");
    return 0;
  }

  const selected = await runPickers(report.importable);

  const plan = buildPlan({
    origin,
    defaultSourceName: sourceName,
    selected,
    artifactRoot: ctx.artifactRoot,
  });

  if (ctx.dryRun) {
    note(renderDryRun(plan));
    return 0;
  }

  const proceed = assertSelected(
    await confirm({
      message: `Will write ${plan.items.length} artifacts. Proceed?`,
      initialValue: true,
    }),
  );
  if (!proceed) return 0;

  writePlan(plan, { artifactRoot: ctx.artifactRoot });
  note(`wrote ${plan.items.length} artifacts`);

  const goInit = assertSelected(
    await confirm({
      message: "Run 'umbel init' now to put them in a bundle?",
      initialValue: true,
    }),
  );
  if (goInit) {
    const { runInitWizard } = await import("./bundle-init.ts");
    const { userBundlesDir, projectBundlesDir } = await import("../bundle/dirs.ts").catch(async () => {
      // bundle/dirs may not exist; fall back to inline derivation used by run.ts
      const m = await import("../run.ts");
      return { userBundlesDir: m.userBundlesDir, projectBundlesDir: m.projectBundlesDir };
    });
    const code = await runInitWizard({
      userBundlesDir: userBundlesDir(process.env),
      projectBundlesDir: projectBundlesDir(ctx.cwd, ctx.home),
      cwd: ctx.cwd,
      home: ctx.home,
      artifactRoots: {
        skills: `${ctx.artifactRoot}/skills`,
        agents: `${ctx.artifactRoot}/agents`,
      },
    });
    return code;
  }
  note("Tip: run 'umbel init' later to compose a bundle from these artifacts.");
  return 0;
}

async function chooseOrigin(ctx: AdoptWizardCtx): Promise<ResolvedOrigin> {
  if (ctx.refreshOrigin) return ctx.refreshOrigin;
  const kind = assertSelected(
    await select<"global" | "project">({
      message: "Where do you want to import from?",
      options: [
        {
          label: "Global  (~/.claude — direct items + ALL plugins in plugins/cache)",
          value: "global",
        },
        { label: "Project (you'll provide a path — direct items only)", value: "project" },
      ],
    }),
  );
  if (kind === "global") return resolveOrigin({ kind: "global" }, { home: ctx.home });
  const path = assertSelected(
    await text({
      message: "Project path",
      placeholder: ctx.cwd,
      initialValue: ctx.cwd,
      validate: (v) => validateClaudeProjectPath(v ?? "", { home: ctx.home }),
    }),
  );
  return resolveOrigin(
    { kind: "project", path: expandHomePath(path, ctx.home) },
    { home: ctx.home },
  );
}

async function maybePickPluginVersions(
  origin: ResolvedOrigin,
  ctx: AdoptWizardCtx,
): Promise<Record<string, string>> {
  if (origin.kind !== "global") return {};
  const groups = listCachedPlugins(`${origin.root}/plugins/cache`);
  const multi = groups.filter((g) => g.versions.length > 1);
  if (multi.length === 0) {
    const auto: Record<string, string> = {};
    for (const g of groups) {
      if (g.versions[0] !== undefined) auto[`${g.marketplace}-${g.plugin}`] = g.versions[0];
    }
    return auto;
  }
  const out: Record<string, string> = {};
  for (const g of groups) {
    if (g.versions.length === 1 && g.versions[0] !== undefined) {
      out[`${g.marketplace}-${g.plugin}`] = g.versions[0];
      continue;
    }
    const rec = pickRecommendedVersion(g.versions);
    const choice = assertSelected(
      await select<string>({
        message: `Plugin ${g.marketplace}/${g.plugin} has ${g.versions.length} versions`,
        options: g.versions.map((v) => ({
          value: v,
          label: rec !== null && v === rec ? `${v}  (recommended: newest)` : v,
        })),
      }),
    );
    out[`${g.marketplace}-${g.plugin}`] = choice;
  }
  return out;
}

async function chooseSourceName(origin: ResolvedOrigin): Promise<string> {
  if (origin.kind === "plugin") return defaultSourceNameFor(origin);
  const def = defaultSourceNameFor(origin);
  const raw = assertSelected(
    await text({
      message: `Adopt direct .claude/ items under source name`,
      initialValue: def,
      validate: (v) => (isValidSlug(slugify(v ?? "")) ? undefined : "slug must be non-empty"),
    }),
  );
  return slugify(raw);
}

function emitReport(report: ReturnType<typeof scan>): void {
  const counts: Record<ArtifactKind, number> = { skills: 0, agents: 0, hooks: 0, mcps: 0 };
  for (const it of report.importable) counts[it.kind] += 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  note(
    `Importable: ${total}\n  skills: ${counts.skills}   agents: ${counts.agents}   hooks: ${counts.hooks}   mcps: ${counts.mcps}\nNot importable: ${report.unimportable.length}\n${report.unimportable
      .map((u) => `  • ${u.kind}/${u.leaf}  ${u.reason ?? ""}`)
      .join("\n")}`,
  );
}

function hasAnyReadyAnywhere(items: AdoptableItem[]): boolean {
  return ARTIFACT_KINDS.some((k) => hasAnyReady(items.filter((i) => i.kind === k)));
}

async function runPickers(items: AdoptableItem[]): Promise<AdoptableItem[]> {
  const picked: AdoptableItem[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const groups = buildAdoptPickerGroups(items, kind);
    const ofKind = items.filter((i) => i.kind === kind);
    if (ofKind.length === 0) continue;
    if (!hasAnyReady(ofKind)) continue;
    const v = await pickGrouped<AdoptableItem>({
      message: `Select ${kind} to import:`,
      groups,
      required: false,
    });
    for (const it of v) picked.push(it);
  }
  return picked;
}

function renderDryRun(plan: ReturnType<typeof buildPlan>): string {
  const lines = plan.items.map(
    (p) => `  ${p.item.kind}/${p.sourceName}/${p.item.leaf}`,
  );
  return `Would write ${plan.items.length} artifacts:\n${lines.join("\n")}`;
}
```

(The dynamic import for `userBundlesDir` / `projectBundlesDir` is intentionally defensive: those helpers live in `src/run.ts` today. If they aren't exported there yet, export them additively in `src/run.ts` as part of this task — that is an additive export, not a behaviour change, so it stays within AC #11.)

- [ ] **Step 3: Run typechecker**

Run: `npx tsc --noEmit && npm test`
Expected: all pass; pre-existing suite still green.

- [ ] **Step 4: Commit**

```bash
git add src/ui/adopt-wizard.ts src/run.ts
git commit -m "feat(adopt): interactive wizard composition"
```

---

## Task 18: Adopt entry + arg parser

**Files:**
- Create: `src/adopt/index.ts`
- Create: `src/adopt/args.ts`
- Modify: `src/run.ts` (replace the task-1 stub with the real call)
- Test: `test/unit/adopt/args.test.ts`

`runAdoptWizard(rest, env, cwd)`:
- Parses adopt-specific flags (`--dry-run`, `--refresh <name>`, `-h/--help`).
- TTY guard: non-interactive → `UsageError("umbel adopt: requires a TTY")`.
- Dispatches: refresh+wizard or wizard-only.

- [ ] **Step 1: Write the failing test for arg parser**

```ts
// test/unit/adopt/args.test.ts
import { describe, expect, it } from "vitest";
import { parseAdoptArgs } from "../../../src/adopt/args.ts";
import { UsageError } from "../../../src/errors.ts";

describe("parseAdoptArgs", () => {
  it("defaults", () => {
    const o = parseAdoptArgs([]);
    expect(o).toEqual({ dryRun: false, refreshSource: null, help: false });
  });
  it("--dry-run", () => {
    expect(parseAdoptArgs(["--dry-run"]).dryRun).toBe(true);
  });
  it("--refresh <name>", () => {
    expect(parseAdoptArgs(["--refresh", "claude"]).refreshSource).toBe("claude");
  });
  it("--refresh=<name>", () => {
    expect(parseAdoptArgs(["--refresh=claude"]).refreshSource).toBe("claude");
  });
  it("--refresh requires value", () => {
    expect(() => parseAdoptArgs(["--refresh"])).toThrow(UsageError);
  });
  it("-h / --help", () => {
    expect(parseAdoptArgs(["-h"]).help).toBe(true);
    expect(parseAdoptArgs(["--help"]).help).toBe(true);
  });
  it("unknown flag → UsageError", () => {
    expect(() => parseAdoptArgs(["--nope"])).toThrow(UsageError);
  });
  it("positional → UsageError", () => {
    expect(() => parseAdoptArgs(["foo"])).toThrow(UsageError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/args.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `src/adopt/args.ts`**

```ts
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
```

- [ ] **Step 4: Create `src/adopt/index.ts`**

```ts
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

function metaToOrigin(
  meta: ReturnType<typeof readMeta>,
  home: string,
): ResolvedOrigin {
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
```

- [ ] **Step 5: Wire the real dispatch in `src/run.ts`**

Replace the task-1 stub:

```ts
if (verb === "adopt") {
  const { runAdopt } = await import("./adopt/index.ts");
  return runAdopt(rest, env, cwd);
}
```

(Dynamic import keeps `umbel`'s cold-start cost for non-adopt verbs unchanged — adopt's `@clack/prompts` import chain only loads when actually used.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run test/unit/adopt/args.test.ts && npm test`
Expected: all pass; pre-existing suite still green.

- [ ] **Step 7: Commit**

```bash
git add src/adopt/args.ts src/adopt/index.ts src/run.ts test/unit/adopt/args.test.ts
git commit -m "feat(adopt): adopt entry point (arg parser + TTY guard + refresh wiring)"
```

---

## Task 19: Empty-state hint in `umbel list`

**Files:**
- Modify: `src/run.ts` (add ONE additional output line to the existing `umbel list` empty-state branch)
- Test: `test/unit/adopt/list-empty-hint.test.ts` (new — does not touch existing list tests, of which there is none in `test/unit/`)

Per design Discoverability:

> `umbel list` on an empty artifact root prints a one-line hint: `No artifacts found. Run 'umbel adopt' to import from your existing ~/.claude/ setup.`

**Before editing**, run `grep -nR "umbel list" test/unit/ 2>/dev/null` to confirm no existing test snapshots the list output. If something pins the exact bytes, this task becomes a no-op (file an AC #11 follow-up to relax that test in a separate audit; for this PR, the discoverability hint stays in `--help` only).

- [ ] **Step 1: Audit existing tests**

Run: `grep -nR "umbel list\|runBundleList\|loadBundleIndex" test/unit/ 2>/dev/null`
Expected: no exact-equality assertion on list output. If you find one, **stop**, skip this task entirely, and proceed to task 20 — note the constraint in the README discoverability bullet as a known follow-up.

- [ ] **Step 2: Write the failing test**

```ts
// test/unit/adopt/list-empty-hint.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../src/run.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-list-hint-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("umbel list — empty-state hint", () => {
  it("prints the adopt nudge when no bundles + no artifacts exist", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    await run(["list"], {
      env: { UMBEL_ARTIFACTS_DIR: tmp, HOME: tmp },
      cwd: tmp,
    });
    expect(out.join("")).toMatch(/umbel adopt/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/unit/adopt/list-empty-hint.test.ts`
Expected: FAIL — hint not printed yet.

- [ ] **Step 4: Edit `src/run.ts`**

Find `runBundleList`. After the existing "no bundles found" message (or whatever the empty branch currently prints), additionally check whether `$UMBEL_ARTIFACTS_DIR` is empty (no `skills/`, `agents/`, `hooks/`, `mcps/` subdirs with any content). If empty, append:

```
Run 'umbel adopt' to import from your existing ~/.claude/ setup.
```

The additive nature is critical: do **not** delete or rearrange existing list output. Add one extra `process.stdout.write(...)` call guarded by the empty-artifact-root check.

- [ ] **Step 5: Run tests**

Run: `npx vitest run test/unit/adopt/list-empty-hint.test.ts && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/run.ts test/unit/adopt/list-empty-hint.test.ts
git commit -m "feat(adopt): empty-state hint in 'umbel list' pointing to adopt"
```

---

## Task 20: Documentation (README + CHANGELOG)

**Files:**
- Modify: `README.md` (additive Quickstart bullet + new "Adopt" section)
- Modify: `CHANGELOG.md` (additive entry under `## Unreleased`)

Pure documentation additions. No test owed; verified by reading.

- [ ] **Step 1: Read existing README structure**

Run: `head -80 README.md && grep -n "^##\|^###" README.md | head -20`
Expected: identify the Quickstart section and a suitable insertion point for a new "Adopt" section near it.

- [ ] **Step 2: Edit `README.md`**

In Quickstart, add as the first bullet (or "step 0"):

```
If you already have a working ~/.claude/ setup, start with:

    umbel adopt

This walks you through importing your existing skills, agents, hooks, and
MCP servers (including plugin-shipped ones) into umbel.
```

Add a new section `### Adopt` near the existing "Installing artifacts" section with a 5–10 line summary cross-linking `docs/adopt-overview.md` and `docs/adopt-design.md`.

- [ ] **Step 3: Edit `CHANGELOG.md`**

Under `## Unreleased`, add:

```
### Adopt

- New interactive verb `umbel adopt` imports existing Claude Code artifacts
  (skills, agents, hooks, stdio MCP servers — including plugin-shipped
  ones) from `~/.claude/`, a project `.claude/`, or
  `~/.claude/plugins/cache/` into `$UMBEL_ARTIFACTS_DIR`. Adopt-managed
  items are tracked in `$UMBEL_ARTIFACTS_DIR/.adopt-meta/<source>.json`;
  `umbel adopt --refresh <source>` re-imports only those, preserving
  hand-rolled siblings. `umbel adopt --dry-run` prints the resolved plan
  without writing.
- `umbel list` on an empty artifact root now suggests `umbel adopt`.
```

- [ ] **Step 4: Run tests + biome**

Run: `npm test && npx biome check . && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs(adopt): README quickstart + CHANGELOG entry"
```

---

## Task 21: Round-trip integration test

**Files:**
- Create: `test/unit/adopt/roundtrip.test.ts`

Per design AC #5 and the testing section: fixture → adopt write phase → synthesize bundle manifest referencing imported items → call existing `compile()` → bit-exact snapshot assertion. Covers a plugin hook with same-dir sidecar, a stdio mcp, and a basic skill.

- [ ] **Step 1: Write the test**

```ts
// test/unit/adopt/roundtrip.test.ts
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { buildPlan } from "../../../src/adopt/plan.ts";
import { scan } from "../../../src/adopt/scan.ts";
import { writePlan } from "../../../src/adopt/write.ts";
import { defaultSourceNameFor } from "../../../src/adopt/origin.ts";
// import the existing compile() — exact symbol name should be picked up from
// `src/bundle/compile.ts`. The test deliberately drives the real compiler so
// any drift between adopt's output shape and what compile expects fails here.
import { compile } from "../../../src/bundle/compile.ts";

describe("adopt → compile round-trip", () => {
  it("produces a compiled bundle layout matching the snapshot", () => {
    const tmp = mkdtempSync(join(tmpdir(), "umbel-rt-"));
    try {
      const home = join(tmp, "home");
      const claude = join(home, ".claude");
      mkdirSync(claude, { recursive: true });
      // 1. a basic skill
      const skillDir = join(claude, "skills", "demo");
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, "SKILL.md"),
        "---\nname: demo\ndescription: a demo skill\n---\nbody\n",
      );
      // 2. a stdio mcp
      writeFileSync(
        join(claude, ".mcp.json"),
        JSON.stringify({ mcpServers: { fsmcp: { command: "fs-mcp" } } }),
      );
      // 3. a plugin hook with same-dir sidecar
      const pluginRoot = join(claude, "plugins", "cache", "mkt", "p", "1.0.0");
      mkdirSync(join(pluginRoot, ".claude-plugin"), { recursive: true });
      writeFileSync(
        join(pluginRoot, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "p", version: "1.0.0" }),
      );
      mkdirSync(join(pluginRoot, "hooks"), { recursive: true });
      writeFileSync(join(pluginRoot, "hooks", "log.sh"), "#!/bin/sh\necho hi\n");
      writeFileSync(
        join(pluginRoot, "hooks", "hooks.json"),
        JSON.stringify({
          PreToolUse: [
            {
              matcher: "*",
              hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" }],
            },
          ],
        }),
      );

      // Run adopt: scan → buildPlan(selecting every ready item) → writePlan
      const artifactRoot = join(tmp, "artifacts");
      const origin = { kind: "global" as const, root: claude };
      const sourceName = defaultSourceNameFor(origin);
      const report = scan(origin, {
        artifactRoot,
        sourceName,
        pluginVersionByGroup: { "mkt-p": "1.0.0" },
      });
      const selected = report.importable.filter((i) => i.status === "ready");
      const plan = buildPlan({
        origin,
        defaultSourceName: sourceName,
        selected,
        artifactRoot,
      });
      writePlan(plan, { artifactRoot });

      // Write a bundle manifest referencing exactly the adopted items.
      const bundlesDir = join(artifactRoot, "..", "bundles");
      mkdirSync(bundlesDir, { recursive: true });
      const manifestPath = join(bundlesDir, "rt.md");
      writeFileSync(
        manifestPath,
        `---\nname: rt\nskills: [claude/demo]\nhooks: [cc-plugin-mkt-p/log]\nmcps: [claude/fsmcp]\n---\n`,
      );

      // Compile and snapshot the layout.
      const compiled = compile({ manifestPath, artifactRoot, /* …whatever args compile expects */ });
      // Walk compiled dir; snapshot relative paths + key file contents.
      const snapshot: Record<string, string> = {};
      walk(compiled as unknown as string, (abs, rel) => {
        snapshot[rel] = readFileSync(abs, "utf8");
      });
      expect(snapshot).toMatchSnapshot();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

function walk(root: string, visit: (abs: string, rel: string) => void): void {
  function rec(dir: string): void {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, name.name);
      if (name.isDirectory()) rec(abs);
      else visit(abs, relative(root, abs));
    }
  }
  rec(root);
}
```

**Note:** the exact signature of `compile()` and its return value depend on what `src/bundle/compile.ts` exposes today. Read that file once and adapt the call site (the test must call the *existing* function — do not modify `compile.ts`). If the public entry point is named differently (e.g. `compileBundle`, `runBuild`), use that name. If it returns the cache dir path, walk that; if it writes to a known location, walk *that*.

- [ ] **Step 2: Run test, accept snapshot**

Run: `npx vitest run test/unit/adopt/roundtrip.test.ts`
Expected: first run creates `__snapshots__/roundtrip.test.ts.snap`. Review the snapshot manually — verify:
- `skills/<finalName>/SKILL.md` exists with the right frontmatter
- `hooks/<finalName>/log.sh` exists
- `settings.json` (or wherever compile emits hooks) contains a `PreToolUse` entry with `command: "${CLAUDE_PLUGIN_ROOT}/hooks/<finalName>/log.sh"`
- `.mcp.json` contains `fsmcp: { command: "fs-mcp" }`

If any of those are wrong, the bug is in adopt's writer/planner, not the compiler — fix adopt and rerun. If all are right, commit the snapshot.

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add test/unit/adopt/roundtrip.test.ts test/unit/adopt/__snapshots__
git commit -m "test(adopt): bit-exact round-trip via existing compile()"
```

---

## Task 22: Final non-regression audit

**Files:** none

This is a verification checklist, not a code change. If anything fails, fix it before declaring the feature done.

- [ ] **Step 1: Re-confirm full suite green**

Run: `npm test 2>&1 | tail -5`
Expected: All pre-existing test files still pass with original assertions intact. New `test/unit/adopt/` files all pass.

- [ ] **Step 2: Confirm only allowed files outside `src/adopt/` and `test/unit/adopt/` were touched**

Run: `git diff --name-only f81df8d..HEAD | sort`
Expected: every changed/added file is one of:
- `src/adopt/**` (new)
- `src/ui/adopt-wizard.ts` (new)
- `src/ui/path-prompt.ts` (new)
- `test/unit/adopt/**` (new)
- `docs/adopt-design.md`, `docs/adopt-overview.md` (pre-existing PR scope)
- `docs/superpowers/plans/2026-05-26-umbel-adopt.md` (this plan)
- `src/args.ts` (`BUNDLE_VERBS` add + help line)
- `src/run.ts` (dispatch branch + list empty-state hint, plus optional additive exports for `userBundlesDir` / `projectBundlesDir`)
- `README.md`, `CHANGELOG.md` (additive)
- `package.json`, `package-lock.json` (only if semver added)

If you see anything under `src/bundle/`, `src/source/`, `src/applier/`, `src/planner/`, `src/state/`, or in a pre-existing test file, **revert that hunk** — AC #11 is broken.

- [ ] **Step 3: Lint + types**

Run: `npx biome check . && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual smoke (interactive)**

In a real terminal:

```bash
npm run build
node dist/cli.js adopt --help
node dist/cli.js adopt --dry-run     # walks wizard, exits 0 without writing
node dist/cli.js list                # expect adopt hint when artifact root empty
```

Confirm: help renders cleanly, dry-run writes nothing under `$UMBEL_ARTIFACTS_DIR`, and the list hint appears on an empty root.

- [ ] **Step 5: Commit the plan itself if not already**

If `docs/superpowers/plans/2026-05-26-umbel-adopt.md` isn't committed:

```bash
git add docs/superpowers/plans/2026-05-26-umbel-adopt.md
git commit -m "docs(adopt): implementation plan"
```

- [ ] **Step 6: Hand off**

The MVP acceptance criteria (1–11 in `docs/adopt-design.md`) should now all be exercised by tests. Report status to the user — do not push to remote until they explicitly authorise it (per the standing security constraint on this branch).

---

## Self-Review Notes

**Spec coverage:**
- AC #1 (happy global) — exercised by scan.test.ts + write.test.ts + roundtrip.test.ts.
- AC #2 (happy project) — origin.test.ts covers project resolution; round-trip variant could be added if regression appears.
- AC #3 (refresh path) — refresh.test.ts covers the delete; manual smoke verifies the full re-import loop.
- AC #4 (unimportable surfacing) — covered across importers/*.test.ts (skills bad YAML, mcps http, plugins missing identity).
- AC #5 (hook same-dir sidecar) — write.test.ts + roundtrip.test.ts.
- AC #6 (dry-run write-side) — task 17 + 18 + manual smoke.
- AC #7 (refresh dry-run) — task 18 (`if (!args.dryRun) executeRefresh`); add a focused test in `refresh.test.ts` if the wizard composition shifts.
- AC #8 (duplicate canonical) — skills.test.ts.
- AC #9 (empty origin) — wizard early-exit branch in task 17; verified by manual smoke.
- AC #10 (.adopt-meta resilience) — meta.test.ts NotFoundError case + refresh.test.ts.
- AC #11 (non-regression) — task 22 audit + `npm test` after every commit.

**Placeholder scan:** no `TODO`, `TBD`, or "implement later" — all steps carry actual code or commands. Two cases use "if the team prefers" / "if the compile signature differs" — those are legitimate engineering judgement calls flagged for the implementer, not placeholders.

**Type consistency:** `AdoptableItem`, `ImporterSource`, `ResolvedOrigin`, `ImportPlan`, `AdoptMeta` are defined once in task 2 and referenced verbatim everywhere after. The hook importer's `crossDirRel` / `pluginRoot` / `sidecarsDir` smuggling via `as never` is the one type-system compromise; called out explicitly in task 9 so the implementer can choose to extend the union instead.

**Open: the round-trip test depends on `compile()`'s actual public signature.** Task 21 explicitly tells the implementer to read `src/bundle/compile.ts` and adapt the test call site. This is *not* a placeholder — it is a deliberate "the existing API is the contract" pointer.
