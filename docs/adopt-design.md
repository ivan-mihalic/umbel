# `umbel adopt` — design

Interactive on-ramp that imports existing Claude Code artifacts (from
`~/.claude/` global, a project's `.claude/`, or `~/.claude/plugins/cache/`)
into `$UMBEL_ARTIFACTS_DIR` so umbel can resolve them in bundles. Adopt is
a pure importer; it does not create or mutate bundle manifests. On
completion it offers to launch `umbel init` to compose a bundle from the
just-imported (or any other) artifacts.

This document is the design contract. The implementation plan is
generated from it via `superpowers:writing-plans` and lives separately.

## Goals

- Give users a one-command path to "I have skills/agents/hooks/mcps in
  `.claude/` — get them into umbel."
- Robust scan that handles **everything umbel models**: skills, agents,
  hooks, mcps — across direct `.claude/` layout AND
  `.claude/plugins/cache/` layout.
- Honest reporting: items that can't be imported are *visible* to the
  user with the reason; never silently dropped.
- Compose with existing `umbel init` without coupling.

## Non-goals (MVP)

- Importing Claude Code slash commands (`commands/`) — umbel does not
  model this kind.
- Non-stdio MCP transports (`http`, `sse`). MCP servers with these
  transports are surfaced as unimportable.
- Editing existing bundle manifests. `adopt → init` always produces a
  *new* bundle. Adding adopted refs to an existing manifest is a manual
  copy-paste for MVP.
- Symlink / live-mirror mode. Adopt always produces a frozen snapshot.
- Non-interactive flags (`umbel adopt --source <path> --skills foo,bar`).
  Track as follow-up once the interactive UX is stable.
- Multiple origins in a single invocation. One run = one origin; re-run
  for another.
- Automatic rollback on partial write failure. Surface error + list of
  already-written items; user re-runs.
- Bundle-level settings extraction (`model`, `env`, `statusLine`,
  `permissions`, `outputStyle` from `~/.claude/settings.json` or a
  project `.claude/settings.json`). These live in bundle *manifests*,
  not artifact dirs; adopt is artifact-only. Users hand-edit the
  manifest after `init` if they want them carried across.

## User-visible behavior

### New verb

`umbel adopt` — added to `BUNDLE_VERBS` in `src/args.ts`. Flags in MVP:
- `--dry-run` — wizard runs normally through step [4] picker, then
  prints the resolved `ImportPlan` and exits `0` without entering
  step [5] write or the init hand-off. Requires an interactive TTY
  (non-TTY → `UsageError`; non-interactive mode is follow-up). Exit
  code is `0` even when the plan contains only unimportable items.
  When combined with `--refresh <source>`: prints
  `Would delete N items under '<source>' then re-import:` followed
  by the plan; does **not** delete the bucket.
- `--refresh <source-name>` — read
  `$UMBEL_ARTIFACTS_DIR/.adopt-meta/<source-name>.json`, delete only
  the items listed there (hand-rolled siblings preserved), then
  enter the normal interactive wizard with origin auto-resolved from
  the metadata. Source bucket name typically comes from a previous
  adopt run (e.g. `cc-plugin-claude-plugins-official-superpowers`).
  Upgrade workflow: `umbel adopt --refresh <slug>` → pick the newer
  version in step [3.5] → continue normally. Full mechanics in
  *Conflict policy* below.
- `-h, --help`.

### Wizard flow

```
[1] Origin
    > Where do you want to import from?
      • Global  (~/.claude — direct items + ALL plugins in plugins/cache)
      • Project (you'll provide a path — direct items only; CC plugins
                 are user-global, never per-project)
    [if Project:]
    > Project path: [/Users/.../current-cwd-or-detected-project-root]
                    (plain text input, MVP — no tab completion; cwd
                     prefilled, editable; hint shown:
                     "absolute path; ~ expansion handled, no tab
                     completion in MVP";
                     validates path exists + contains .claude/)

[2] Scan + report
    Scanning /Users/.../project-a/.claude ...
    Importable: 47
      skills: 28   agents: 3   hooks: 12   mcps: 4
    Not importable: 6
      • commands/ from 3 plugins        Claude Code slash commands (not modeled)
      • hooks/x in superpowers           hooks.json entry missing 'matcher'
      • mcps/atlassian                   transport 'http' (umbel supports stdio only)
      • skills/broken-skill              SKILL.md frontmatter: bad YAML at line 4
    Continue? [Y/n]

[3] Source name (direct items only)
    > Adopt direct .claude/ items under source name: [claude-project-a]   ← prefilled, editable text
    (Result: $UMBEL_ARTIFACTS_DIR/<kind>/claude-project-a/<leaf>/)

    Plugin items use auto-derived `cc-plugin-<marketplace>-<plugin>`
    source names — not prompted, shown in the [5] write summary.

[3.5] Plugin version selection (conditional)
    Fires once per plugin that has >1 version in cache. Skipped entirely
    if every plugin has exactly one cached version.
    > Plugin `claude-plugins-official/superpowers` has 3 versions:
      ○ 5.1.0
      ○ 5.2.0  (recommended: newest)
      ○ 5.3.0
    > Pick one to adopt from:

[4] Per-category multi-select pickers (clack multiselect, grouped)
    Pruning rules:
    - Categories with zero items in `importable` are skipped entirely
      (no `Select X: [no items]` noise).
    - Categories where every item is `[× cannot import]` are also
      skipped — the report already lists them.
    - If after pruning no pickers remain (all categories empty or
      all-unimportable), wizard early-exits with message:
      `Nothing to import from <origin>. (See report above for
      unimportable items.)` and exit code 0.
    - Built-in `@clack/prompts` `a` shortcut (toggle all) is left
      as the only shortcut; no custom select-all/none added.
    - One picker per kind (never a single mega-picker grouped by
      kind) — separation reinforces the user's mental model.

    > Select skills to import:

      ── claude (global ~/.claude/skills) ──
        [x] my-custom-skill
        [ ] old-skill                                  [already imported]

      ── claude-plugins-official-superpowers@5.2.0 ──
        [x] brainstorming
        [x] test-driven-development
        ...

      ── claude-plugins-official-atlassian@9b52fb18 ──
        [x] confluence-search
        [ ] broken-skill                               [× cannot import: bad YAML]

    > Select agents to import: ...
    > Select hooks to import: ...
    > Select mcps to import: ...

[5] Write + hand-off
    Will write 7 artifacts (12 files, 23 KB) under
    $UMBEL_ARTIFACTS_DIR/{skills,agents,hooks,mcps}/project-a/...
    Proceed? [Y/n]
    ✓ wrote 7 artifacts.

    Run `umbel init` now to put them in a bundle? [Y/n]
    [if yes: runInitWizard() called inline — init runs unmodified;
     it asks its own scope (user vs project) prompt against the
     current cwd. Adopt does not prefill or override init's UX.]
    [if no: print tip → "Run 'umbel init' later to compose a bundle
     from these artifacts." No state preserved between runs.]
```

### Source naming (reserved namespace)

`<source>` is the first segment of the `<source>/<leaf>` qualified ref
used in bundle manifests. Per `docs/bundles-spec.md` it is an
operator-chosen identifier; adopt narrows that freedom by **reserving
three prefixes** for adopt-managed content, so future tooling (refresh,
diff, cleanup) can recognize what it owns:

| Origin                                | Reserved source name                                    |
|---------------------------------------|---------------------------------------------------------|
| Global `~/.claude`                    | `claude`                                                |
| Project `/abs/path/foo/.claude`       | `claude-project-foo` (basename slug of the project dir) |
| Plugin `cache/<mkt>/<plugin>/<ver>/`  | `cc-plugin-<marketplace>-<plugin>` (single segment)     |

These names are **prefilled** in the source-name step and the picker
**warns** if the user overrides them ("Adopt-managed sources start with
`claude` / `claude-project-` / `cc-plugin-`. Continue with custom name?").
A custom name is allowed; the warning just prevents accidents.

Slug rules (all reserved names):
- lowercase.
- runs of non-alnum characters (`/`, `_`, `.`, `@`, spaces, any
  non-ASCII) collapse to a single `-`. No Unicode normalization in
  MVP — `föö` becomes `f`, `Žluťoučký` becomes `lu-ou-k`.
  Diacritics handling is a follow-up if user feedback shows demand.
- leading/trailing `-` trimmed.
- the marketplace+plugin slug stays a *single segment* — preserves the
  2-segment `<source>/<leaf>` schema umbel's `splitRef()` assumes.
- If the resulting string is empty or contains only `-`, the source
  is `unimportable` with `reason = "cannot derive slug from <orig>"`.

Versioning: plugin source names do **not** include the version
(`cc-plugin-claude-plugins-official-superpowers`, not
`...-superpowers@5.1.0`). The picker still groups by `@<version>` for
visibility, but the on-disk source is version-agnostic — adopting v5.2
later overwrites/extends the same source bucket (subject to conflict
policy below).

### Adopt metadata sidecar

Every successful adopt run writes / updates
`$UMBEL_ARTIFACTS_DIR/.adopt-meta/<source>.json`:

```json
{
  "source": "claude",
  "lastAdoptedAt": "2026-05-26T16:50:00Z",
  "origin": { "type": "global" },
  "items": [
    { "kind": "skills", "leaf": "brainstorming" },
    { "kind": "skills", "leaf": "debug" },
    { "kind": "hooks", "leaf": "log-bash" }
  ]
}
```

The metadata exists so `--refresh` knows precisely which items adopt
wrote, and never touches hand-rolled artefacts the user added to the
same source bucket. The file is not part of the artifact-resolution
contract — `splitRef()` / `walkArtifactRoot()` ignore the
`.adopt-meta/` directory. Users may safely delete it; the cost is
losing `--refresh` for that source.

### Conflict policy

If `$UMBEL_ARTIFACTS_DIR/<kind>/<source>/<leaf>/` already exists:

- In the picker, the item renders as `[already imported]` and is
  `disabled: true`.
- The scan-report line for the item appends a hint:
  `[already imported — re-run with --refresh <source> to upgrade]`.
- Per-item overwrite during a normal run is not supported. Bulk
  upgrade is via `--refresh <source>`:
  - Read `$UMBEL_ARTIFACTS_DIR/.adopt-meta/<source>.json`. If
    missing → `NotFoundError: no adopt metadata for source
    '<source>'; manual cleanup required (the source was not
    created by adopt, or its metadata was deleted)`.
  - Prompt: `Will delete N adopt-managed items under source
    '<source>': <list>. Continue? [y/N]`. Hand-rolled artefacts
    in the same source bucket (not in the metadata) are
    explicitly noted as preserved if any are detected.
  - For each item in the metadata, `rm -rf
    $UMBEL_ARTIFACTS_DIR/<kind>/<source>/<leaf>/`. Items already
    missing on disk (manual delete) are soft-skipped. Empty
    `<source>/` dirs are cleaned up after.
  - Enter the wizard. Origin auto-resolved from the metadata
    (`origin.type` → corresponding step [1] selection;
    `origin.path` prefilled for `project`). The metadata-stored
    origin removes the need for slug-pattern inference, so custom
    source names also refresh correctly. Step [1] offers only
    Global/Project, and plugins are scanned *within* Global — so a
    `cc-plugin-*` bucket adopted via Global records
    `origin:{type:global}`, and `--refresh <plugin-source>`
    re-scans Global to re-surface that plugin's items. The
    `{type:plugin}` origin shape (below) is reserved for a future
    direct-plugin origin and is not produced by the MVP flow.
  - After successful re-import, the metadata file is rewritten
    with the new item list and `lastAdoptedAt`.
  - Conflict policy after refresh: bucket is now empty (for
    adopt-managed leafs), so every item appears as `ready` again
    — no `[already imported]` state.

### Unimportable items

Items the scanner can identify but can't translate into umbel's model
render as `[× <short reason>]` with `disabled: true` in the picker. The
step [2] scan report lists them with full reason. They are never
auto-imported.

### Discoverability (MVP)

`adopt` is the recommended first-touch verb for users with an existing
`~/.claude/` setup. To make it findable without forcing follow-up
verbs to know about it:

- `umbel --help` / `umbel adopt --help` — `adopt` appears in the verb
  list with one-line summary.
- `umbel list`, when there are no bundles **and** no adopted
  artifacts, appends a one-line hint after the usual `no bundles
  found` line: `Run 'umbel adopt' to import from your existing
  ~/.claude/ setup.` If any bundles exist, or any artifacts have
  already been adopted, the hint is suppressed. (Other empty-state
  behaviour unchanged.)
- README Quickstart adds `umbel adopt` as the first recommended step
  for users coming from a pre-existing Claude Code installation.
- CHANGELOG `Unreleased` entry under a new "Adopt" heading.

Out of MVP (separate designs):
- Empty-state nudge in `umbel init` ("no artifacts — try `umbel
  adopt` first?").
- `source not found` resolver error embedding `Did you forget to
  run 'umbel adopt'?` hint.

## Architecture

```
src/adopt/
  index.ts                    public: runAdoptWizard(ctx): Promise<number>
  origin.ts                   resolveOrigin({kind, path}) → ResolvedOrigin
  scan.ts                     scan(origin): Promise<ScanReport>
  importers/
    skills.ts                 .claude/skills/<leaf>/SKILL.md → AdoptableItem
    agents.ts                 .claude/agents/<leaf>/AGENT.md → AdoptableItem
    hooks.ts                  settings.json[hooks] → AdoptableItem per (event,matcher,command)
    mcps.ts                   .mcp.json mcpServers + settings.json[mcpServers] → AdoptableItem per server
    plugins.ts                .claude/plugins/cache/<mkt>/<plugin>/<ver>/{skills,agents,hooks,.mcp.json}
  write.ts                    materialize ImportPlan into $UMBEL_ARTIFACTS_DIR + update .adopt-meta/<source>.json
  meta.ts                     read/write/validate .adopt-meta/<source>.json
  refresh.ts                  --refresh flow: read meta, delete adopt-managed items, re-enter wizard
  types.ts                    AdoptableItem, ScanReport, ImportPlan, AdoptMeta
src/ui/
  adopt-wizard.ts             @clack/prompts wiring (text/select/multiselect, picker reuse)
  path-prompt.ts              plain-text path input with ~ expansion + existence/`.claude/` validation (single file so a future tab-completion upgrade is one-file scope)
```

Re-uses:
- `src/ui/picker.ts` — `bucketByQualifiedName`, `pickGrouped`.
- `src/source/walk.ts` — `walkArtifactRoot()` for skills/agents dirs.
- `src/bundle/kinds.ts` — `ARTIFACT_KINDS`, `ArtifactKind`.
- `src/bundle/manifest.ts` — `HookCommand`, `McpServerConfig` shapes
  (target frontmatter spec for synthesized HOOK.md / MCP.md).
- `src/ui/bundle-init.ts` — `runInitWizard()` invoked at hand-off.

New verb wired in `src/args.ts`: `umbel adopt` added to `BUNDLE_VERBS`,
dispatched in `src/run.ts` to `runAdoptWizard(ctx)`.

## Data model

```ts
type ImporterSource =
  | { type: "dir"; path: string }                     // skills, agents, plugin assets
  | { type: "settings-hook"; settingsPath: string;    // settings.json[hooks]
      event: string; matcher: string; entry: HookCommand }
  | { type: "mcp-json"; jsonPath: string;             // .mcp.json or settings.json
      serverName: string; config: McpServerConfig };

type AdoptableItem = {
  kind: ArtifactKind;            // skills | agents | hooks | mcps
  leaf: string;                  // derived per kind: skills/agents = frontmatter `name:` > dir basename; hooks = sidecar basename or `<slug32>-<hash4>`; mcps = JSON key
  originGroup: string;           // group key for the picker (slug; e.g. "claude-plugins-official-superpowers@5.1.0")
  originLabel: string;           // display label for the group separator
  source: ImporterSource;
  status: "ready" | "already-imported" | "unimportable";
  reason?: string;               // populated for status = unimportable
};

type ScanReport = {
  origin: ResolvedOrigin;
  importable: AdoptableItem[];   // status === "ready" | "already-imported"
  unimportable: AdoptableItem[]; // status === "unimportable"
};

type ImportPlan = {
  sourceName: string;            // user-confirmed source slug for output paths
  items: Array<{
    item: AdoptableItem;
    writes: PlannedWrite[];      // files (or symlink-as-copy) the writer will create
  }>;
};

type AdoptMeta = {
  source: string;                // source slug
  lastAdoptedAt: string;         // ISO-8601 UTC
  origin:                        // enough to re-run the wizard during --refresh
    | { type: "global" }
    | { type: "project"; path: string }
    | { type: "plugin"; marketplace: string; plugin: string }; // version-agnostic
  items: Array<{ kind: ArtifactKind; leaf: string }>;
};
```

## Importer specs

### skills / agents

- Walker: existing `walkArtifactRoot()`.
- Each `<dir>/SKILL.md` (or `AGENT.md`) parsed via `gray-matter`. Parse
  failure → `status: unimportable`, reason = first line of YAML error
  + hint matching `compile.ts` error style.
- Leaf name = frontmatter `name:` if present, else dir basename
  (matches `pickCanonicalName()` in `compile.ts` — keeps adopt
  symmetric with `umbel build`).
- Duplicate canonical names within a single origin (e.g. two
  `SKILL.md` files both declaring `name: foo` in different dirs):
  **both** items rendered `unimportable` with reason
  `duplicate canonical name 'foo' (also in <other-dir>)`. Adopt
  does not silently pick a winner; user resolves the collision in
  the source tree and re-runs.
- Materialize: `cpSync(srcDir, dstDir, { recursive: true, dereference: true })`.

### hooks

- Sources:
  - `~/.claude/settings.json` (global), `<project>/.claude/settings.json`
    — both at `hooks[event][i]` shape: `{ matcher, hooks: [{ type:
    "command", command, ...}] }`.
  - Plugin `hooks/hooks.json` — same shape; sidecar files in the plugin
    `hooks/` dir; commands typically reference `${CLAUDE_PLUGIN_ROOT}/hooks/<sidecar>`.
- One `AdoptableItem` per `(event, matcher, hook-entry)` tuple.
- Validation (mirrors `src/bundle/compile.ts:emitHooks`):
  - `event` non-empty string
  - `matcher` is a string (may be empty)
  - `command` non-empty string
  Missing/wrong → `unimportable`.
- Leaf name:
  - If `command` points to a local sidecar script (e.g.
    `./log.sh` or `${CLAUDE_PLUGIN_ROOT}/hooks/log.sh`): use the
    sidecar basename without extension (`log`).
  - Otherwise (inline command string): `<slug32>-<hash4>` where
    `slug32` = slug of first 32 chars of the command (lowercase,
    non-alnum → `-`, trimmed) and `hash4` =
    `sha256(command).slice(0,4)`. The hash suffix is applied only
    to inline-command leafs; sidecar leafs do not get a hash because
    the sidecar filename is already a stable identity. Deterministic
    across re-runs (same source → same leaf), prevents silent
    collisions when two inline commands share a 32-char prefix.
  Shown in the picker label so the user can see the resulting dir
  name; not editable in MVP.
- Materialize (target is always a per-hook dir
  `$UMBEL_ARTIFACTS_DIR/hooks/<source>/<leaf>/` — `compile.ts:emitHooks`
  uses `cpSync(srcDir, ...)` and expects a dir):
  - Plugin hooks: copy whole `<plugin>/hooks/` directory contents into
    the target dir (all sidecars travel with the hook).
  - settings.json hooks: create an otherwise empty target dir
    containing only `HOOK.md` (no sidecars).
  - Rewrite `${CLAUDE_PLUGIN_ROOT}/...` in `command` to the umbel
    relative form `./<rel>` so umbel's existing
    `rewritePluginRootCommand()` in `compile.ts` (only rewrites
    leading `./<rel>` → `${CLAUDE_PLUGIN_ROOT}/<kind>/<finalName>/<rel>`)
    reattaches it during build.
  - Cross-dir plugin references (e.g.
    `${CLAUDE_PLUGIN_ROOT}/lib/runner.sh` — outside `hooks/`):
    best-effort extra copy. Adopt copies `<plugin-root>/lib/runner.sh`
    into target dir at the same relative path
    (`<target>/lib/runner.sh`) and rewrites command to
    `./lib/runner.sh`. If the referenced file doesn't exist under
    plugin root, the hook is `unimportable` with reason
    `command references missing plugin file <path>`.
  - References outside plugin root (`${HOME}/bin/foo`, absolute
    paths, system commands like `docker`): pass-through unchanged.
    Adopt has no business copying external dependencies. If the
    command is a bare relative `./external/...` without
    `${CLAUDE_PLUGIN_ROOT}` prefix and the file doesn't exist in
    the source bucket, the hook is `unimportable` with reason
    `command references path outside plugin root`.
  - Write `<target>/HOOK.md` with frontmatter `{ name, event, matcher,
    command, ...passThrough }` (matches what `emitHooks` expects).

### mcps

- Sources:
  - `~/.claude/.mcp.json` mcpServers map.
  - `<project>/.mcp.json` mcpServers map.
  - Plugin `<plugin-root>/.mcp.json` mcpServers map.
  - `settings.json[mcpServers]` (rare; also handled).
- One `AdoptableItem` per `mcpServers[name]`. Leaf = JSON key.
- Validation:
  - `type` absent OR `type === "stdio"` → ready.
  - `type === "http" | "sse" | <other>` → `unimportable`, reason
    "umbel supports stdio MCP servers only".
  - `command` required for stdio → otherwise unimportable.
- Materialize: write `MCP.md` with frontmatter `{ name, command, args?,
  env?, description? }` + empty body. Frontmatter shape matches what
  `compile.ts:emitMcps` reads.

### plugins

- Walker: list `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
  entries. Non-dir entries at any level (stray files, broken
  symlinks) are silently skipped — they are not user-authored
  artifacts. For each plugin dir:
  - Resolve identity from sibling `.claude-plugin/plugin.json`
    (`name`, `version`, `description`). If missing → 1 `unimportable`
    line per affected plugin dir:
    `cache/<mkt>/<plugin>/<ver> — missing .claude-plugin/plugin.json
    (likely partial install)`. No items scanned from that dir.
  - originGroup slug: `<marketplace>-<plugin>` (sanitized: lowercase,
    non-alnum → `-`). originLabel: `<marketplace>/<plugin>@<version>`.
  - Run skills/agents/hooks/mcps importers against the plugin root.
  - Surface `commands/` (and any other non-modeled kind) as a single
    `unimportable` line per plugin in the report (NOT per-file).
- Multiple versions of the same plugin: handled by the conditional
  pre-picker step [3.5]. Only plugins with >1 cached version trigger
  the step. "Recommended" label rules:
  - If **every** version string in the list is valid semver
    (`semver.valid()` passes), the highest by `semver.compare()` is
    tagged `(recommended: newest)`.
  - If *any* version string fails `semver.valid()` (commit SHAs,
    date tags, `dev`, mixed schemes), **no** version gets the
    `recommended` label — the user picks manually from a plain
    alphabetically-sorted list. Honest fallback: adopt does not
    pretend to know which is newer when version semantics are
    unclear.
  Once chosen, only that version's items appear in the picker for
  that plugin (other versions are excluded entirely from the scan
  output for the rest of the run). Rationale: collapses an entire
  class of within-picker leaf collisions (`brainstorming` from v5.1
  vs v5.2 both writing to the same version-agnostic source bucket).

## Error handling

Best-effort scanner: any per-file fault becomes one `unimportable`
line in the report; the scan never aborts on a soft error. Specifics:

- Per-item parse/validation errors → `unimportable` with `reason` set.
- File read errors (`EACCES`, `EISDIR`, etc.) on a single artifact
  file (e.g. one `SKILL.md`) → that item only is `unimportable` with
  `reason = "<errno>: <msg>"`; siblings unaffected.
- Top-level config read errors (`settings.json`, `.mcp.json`) →
  one `unimportable` line per affected file (e.g.
  `~/.claude/settings.json — EACCES (permission denied)`). Hooks /
  mcps derived from *that* file are absent from the report; other
  sources scanned normally.
- Settings/MCP JSON malformed → one `unimportable` line with
  `SyntaxError` first message.
- Empty settings.json, `hooks: null`, or `mcpServers: null` are
  **not** errors — they simply yield zero items from that source
  (no `unimportable` line either).

Hard aborts (raised before or during scan as `UsageError`):

- Origin path doesn't exist, or doesn't contain `.claude/` →
  `UsageError` before scan.
- `$UMBEL_ARTIFACTS_DIR` not writable → detected at step [5],
  `UsageError`.
- Write failures mid-step-[5] → propagate, abort write phase, print
  `wrote N of M before failure: <list>`.

## Testing

`test/unit/adopt/` mirrors `src/adopt/`:

- `origin.test.ts` — path resolution, basename derivation, plugin
  marketplace slug rules.
- `importers/skills.test.ts`, `agents.test.ts`, `hooks.test.ts`,
  `mcps.test.ts` — each with `fixtures/` containing valid + malformed
  cases; assert `AdoptableItem[]` shape (status + reason).
  `hooks.test.ts` additionally covers cross-dir plugin references
  (`${CLAUDE_PLUGIN_ROOT}/lib/runner.sh`): file copied into target
  at relative path, command rewritten to `./lib/runner.sh`; missing
  referenced file → `unimportable`.
- `importers/plugins.test.ts` — fixture under `fixtures/plugin-cache/`
  with two plugins (one with skills+hooks, one with http MCP);
  assert grouping + per-plugin commands skip line.
- `scan.test.ts` — full-tree fixture combining direct + plugin layout,
  assert categorization counts.
- `write.test.ts` — materialize an `ImportPlan` against tmp
  `$UMBEL_ARTIFACTS_DIR`; assert files written, sidecars copied,
  `${CLAUDE_PLUGIN_ROOT}` rewritten, frontmatter shape, and
  `.adopt-meta/<source>.json` written with correct item list.
- `meta.test.ts` — read/write/round-trip of
  `.adopt-meta/<source>.json`; missing-file → `NotFoundError`;
  malformed JSON → `UsageError`.
- `refresh.test.ts` — `--refresh` deletes only items listed in
  metadata, preserves hand-rolled siblings; missing metadata file
  raises `NotFoundError`; soft-skips items already gone on disk.
- Round-trip integration test (`test/unit/adopt/roundtrip.test.ts`):
  fixture → adopt write phase → synthesize bundle manifest referencing
  imported items → call existing `compile()` → **bit-exact snapshot
  assertion** on the compiled plugin layout (files, frontmatter,
  rewritten command paths). Snapshot covers: a plugin hook with
  same-dir sidecar, a stdio mcp, and a basic skill. Catches silent
  regressions where adopt and compile drift on frontmatter shape or
  path rewriting.

UI wizard not unit-tested (clack TTY; same posture as
`src/ui/bundle-init.ts`).

## Acceptance criteria

The MVP is complete when **all** of these hold. Each is a test the
implementation plan owes us:

1. **Happy path Global** — `umbel adopt` → Global → scan finds ≥1
   skill + ≥1 plugin → user selects 2 skills from `claude/` + 1
   skill from one plugin → write succeeds → `umbel list` shows
   the new sources → `umbel init` referencing the adopted items
   → `umbel build` passes without resolve error.
2. **Happy path Project** — same as (1) with Project origin and
   cwd-prefilled path.
3. **Refresh path** — after (1), `umbel adopt --refresh claude`
   reads metadata, prompts to delete listed items, re-imports the
   user's selection, rewrites `.adopt-meta/claude.json`. Bundle
   resolve continues to work for the upgraded items.
4. **Unimportable surfacing** — fixture with one broken `SKILL.md`
   (bad YAML), one `http` MCP, one plugin missing
   `.claude-plugin/plugin.json` → all three appear in the scan
   report with their distinct reasons; none are written to disk.
5. **Hook with same-dir sidecar** — fixture plugin where a hook
   references `${CLAUDE_PLUGIN_ROOT}/hooks/log.sh` → adopt copies
   the whole `hooks/` dir → `umbel build` on a bundle referencing
   that hook produces a compiled layout where `log.sh` exists at
   the expected relative path and the command is correctly
   rewritten to `${CLAUDE_PLUGIN_ROOT}/hooks/<finalName>/log.sh`.
   (Cross-dir references like `${CLAUDE_PLUGIN_ROOT}/lib/…` are
   covered by `hooks.test.ts` unit tests, not acceptance.)
6. **Dry-run write-side** — `umbel adopt --dry-run` walks the
   wizard, prints the plan, exits 0, and **writes nothing** to
   `$UMBEL_ARTIFACTS_DIR` or `.adopt-meta/`.
7. **Refresh dry-run** — `umbel adopt --refresh claude --dry-run`
   reads metadata, prints `Would delete N items …` + plan, exits
   0, leaves the bucket and metadata untouched.
8. **Duplicate canonical name** — fixture with two `SKILL.md`
   files both declaring `name: foo` → both render unimportable
   with cross-referencing reason; neither written.
9. **Empty origin** — scanning a `.claude/` with zero modelled
   artifacts → early-exit "Nothing to import from …" with exit
   code 0; no prompts beyond the report.
10. **`.adopt-meta` resilience** — after manually deleting
    `.adopt-meta/claude.json`, `umbel adopt --refresh claude`
    raises `NotFoundError` with the documented message.
11. **Non-regression (load-bearing)** — `adopt` is purely
    additive. No existing umbel verb (`list`, `show`, `build`,
    `apply`, `unpin`, `run`, `init`, `gc`, `skills`) changes
    behaviour or output. Existing bundle compile / resolve paths
    untouched. The full pre-existing test suite passes unchanged.
    This is enforced by:
    (a) no edits to `src/bundle/`, `src/source/`, or any verb
        dispatcher other than the *additive* `BUNDLE_VERBS` entry
        and `run.ts` dispatch case for `adopt`;
    (b) no edits to existing tests; new tests live under
        `test/unit/adopt/` exclusively;
    (c) any cross-cutting changes (e.g. README, CHANGELOG) are
        purely documentation additions.

## Open questions (resolve during implementation)

- **Plugin source slug length** — `cc-plugin-claude-plugins-official-superpowers`
  is verbose. Accept the verbosity in MVP for unambiguous attribution;
  consider an alias mechanism later (`adopt --alias superpowers`).
- **Adopt-managed source detection** — *Resolved.* The reserved
  prefixes (`claude`, `claude-project-`, `cc-plugin-`) are documented
  in `docs/bundles-spec.md` (source attribution section) so users
  hand-authoring bundles know to avoid them.
- **Re-adopt with diff** — `--refresh` ships in MVP for bulk
  upgrades. A finer-grained per-item diff/overwrite flow is a
  follow-up if user feedback shows demand.
