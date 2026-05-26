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

## User-visible behavior

### New verb

`umbel adopt` — added to `BUNDLE_VERBS` in `src/args.ts`. No flags in MVP
beyond `--dry-run` (parity with `umbel skills`) and `-h/--help`.

### Wizard flow

```
[1] Origin
    > Where do you want to import from?
      • Global  (~/.claude)
      • Project (you'll provide a path)
    [if Project:]
    > Project path: (tab-completion preferred; plain text fallback,
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

[3] Source name
    > Adopt under source name: [project-a]   ← prefilled, editable text
    (Result: $UMBEL_ARTIFACTS_DIR/<kind>/project-a/<leaf>/)

[4] Per-category multi-select pickers (clack multiselect, grouped)
    > Select skills to import:

      ── claude (global ~/.claude/skills) ──
        [x] my-custom-skill
        [ ] old-skill                                  [already imported]

      ── claude-plugins-official-superpowers@5.1.0 ──
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
    [if yes: runInitWizard() called inline]
```

### Source naming

`<source>` is the first segment of the `<source>/<leaf>` qualified ref
used in bundle manifests. Adopt prefills it deterministically per origin
and lets the user override:

| Origin                                | Default source name                              |
|---------------------------------------|--------------------------------------------------|
| Global `~/.claude`                    | `claude`                                         |
| Project `/abs/path/foo/.claude`       | `foo` (basename of project dir)                  |
| Plugin `cache/<mkt>/<plugin>/<ver>/`  | `<marketplace>-<plugin>` slug (single segment)   |

The marketplace+plugin slug is a single segment (e.g.
`claude-plugins-official-superpowers`) — preserves the 2-segment
`<source>/<leaf>` schema umbel's `splitRef()` assumes. Different
marketplaces with same plugin name are visibly distinct in the slug.

### Conflict policy

If `$UMBEL_ARTIFACTS_DIR/<kind>/<source>/<leaf>/` already exists:

- In the picker, the item renders as `[already imported]` and is
  `disabled: true`.
- No CLI flag in MVP. Users who want overwrite delete the target dir
  by hand or re-run after `rm -rf`.

### Unimportable items

Items the scanner can identify but can't translate into umbel's model
render as `[× <short reason>]` with `disabled: true` in the picker. The
step [2] scan report lists them with full reason. They are never
auto-imported.

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
  write.ts                    materialize ImportPlan into $UMBEL_ARTIFACTS_DIR
  types.ts                    AdoptableItem, ScanReport, ImportPlan
src/ui/
  adopt-wizard.ts             @clack/prompts wiring (text/select/multiselect, picker reuse)
  path-prompt.ts              text() with tab completion (custom @clack/core prompt, fallback)
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
  leaf: string;                  // canonical name (frontmatter `name:` > dir basename > derived slug)
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
```

## Importer specs

### skills / agents

- Walker: existing `walkArtifactRoot()`.
- Each `<dir>/SKILL.md` (or `AGENT.md`) parsed via `gray-matter`. Parse
  failure → `status: unimportable`, reason = first line of YAML error
  + hint matching `compile.ts` error style.
- Leaf name = frontmatter `name:` if present, else dir basename
  (matches `pickCanonicalName()` in `compile.ts`).
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
- Leaf name: derived from sidecar basename if command points to a local
  script, else slug of first 32 chars of command. Shown in the picker
  label so the user can see the resulting dir name; not editable in
  MVP.
- Materialize (target is always a per-hook dir
  `$UMBEL_ARTIFACTS_DIR/hooks/<source>/<leaf>/` — `compile.ts:emitHooks`
  uses `cpSync(srcDir, ...)` and expects a dir):
  - Plugin hooks: copy whole `<plugin>/hooks/` directory contents into
    the target dir (all sidecars travel with the hook).
  - settings.json hooks: create an otherwise empty target dir
    containing only `HOOK.md` (no sidecars).
  - Rewrite `${CLAUDE_PLUGIN_ROOT}/...` in `command` to the umbel
    relative form `./<rel>` so umbel's existing
    `rewritePluginRootCommand()` in `compile.ts` reattaches it during
    build.
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
  entries. For each plugin dir:
  - Resolve identity from sibling `.claude-plugin/plugin.json`
    (`name`, `version`, `description`).
  - originGroup slug: `<marketplace>-<plugin>` (sanitized: lowercase,
    non-alnum → `-`). originLabel: `<marketplace>/<plugin>@<version>`.
  - Run skills/agents/hooks/mcps importers against the plugin root.
  - Surface `commands/` (and any other non-modeled kind) as a single
    `unimportable` line per plugin in the report (NOT per-file).
- Multiple versions of the same plugin: each version is its own
  originGroup (the `@<version>` suffix in the label disambiguates).
  Picker shows all versions; **no autoselection** (user picks
  explicitly to avoid accidentally adopting two side-by-side versions).

## Error handling

- Per-item parse/validation errors → `unimportable` with `reason` set;
  never throw at the scanner level.
- Origin path that doesn't exist or doesn't contain `.claude/` →
  `UsageError` raised before scan (handled by `src/run.ts` exit-code
  mapping).
- Settings/MCP JSON malformed → surfaced as one `unimportable` item per
  affected file; scanner continues.
- Write failures (filesystem) → propagate, abort write phase, print
  "wrote N of M before failure: <list>".

## Testing

`test/unit/adopt/` mirrors `src/adopt/`:

- `origin.test.ts` — path resolution, basename derivation, plugin
  marketplace slug rules.
- `importers/skills.test.ts`, `agents.test.ts`, `hooks.test.ts`,
  `mcps.test.ts` — each with `fixtures/` containing valid + malformed
  cases; assert `AdoptableItem[]` shape (status + reason).
- `importers/plugins.test.ts` — fixture under `fixtures/plugin-cache/`
  with two plugins (one with skills+hooks, one with http MCP);
  assert grouping + per-plugin commands skip line.
- `scan.test.ts` — full-tree fixture combining direct + plugin layout,
  assert categorization counts.
- `write.test.ts` — materialize an `ImportPlan` against tmp
  `$UMBEL_ARTIFACTS_DIR`; assert files written, sidecars copied,
  `${CLAUDE_PLUGIN_ROOT}` rewritten, frontmatter shape.
- Round-trip integration test (`test/unit/adopt/roundtrip.test.ts`):
  fixture → adopt write phase → synthesize bundle manifest referencing
  imported items → call existing `compile()` → assert compiled layout
  matches expected snapshot.

UI wizard not unit-tested (clack TTY; same posture as
`src/ui/bundle-init.ts`).

## Open questions (resolve during implementation)

- **Source name `claude` for global** — collides with the potential
  future `claude/...` plugin source namespace. Acceptable in MVP since
  plugins use marketplace-qualified slugs; revisit if/when umbel adds
  a reserved-source policy.
- **Plugin source slug length** — `claude-plugins-official-superpowers`
  is verbose. Accept the verbosity in MVP; consider an alias mechanism
  later (`adopt --alias superpowers`).
- **Re-adopt with diff** — today: blocked, skip-by-default. Could grow
  into a `--refresh` flag that shows a diff and prompts to overwrite.
  Out of MVP.
- **Path tab-completion in the project-path prompt** — `@clack/prompts`
  text input doesn't expose tab completion. Either build a custom
  prompt over `@clack/core` (extra LoC) or ship plain text in MVP with
  a hint about supported paths. Decide during implementation based on
  effort.
