# `umbel adopt` — overview for review

One-line summary: a new interactive `umbel adopt` verb that lets users
import their existing Claude Code artifacts (skills, agents, hooks,
MCP servers — including those that ship inside Claude Code plugins)
into umbel so they can be referenced from a bundle.

The detailed engineering contract is in
[`docs/adopt-design.md`](./adopt-design.md). This document is for
product review.

## Why

Today a user with a working `~/.claude/` setup has no quick way to
get their skills / hooks / MCPs into an umbel bundle — they have to
copy files by hand. `umbel adopt` is the on-ramp that closes that
gap and lets users **try umbel without throwing away** what they
already have.

## What it does

`umbel adopt` walks the user through a short interactive wizard.

1. **Pick a source to import from**: their global `~/.claude/`
   (which also covers all installed plugins) or a specific
   project's `.claude/` (path prefilled with the current working
   directory).
2. **See what's there**: adopt scans, then prints a report —
   how many skills / agents / hooks / MCP servers can be
   imported, and which items it found but **can't** import,
   with the reason (e.g. _unsupported MCP transport_, _broken
   manifest_). Nothing is ever silently dropped.
3. **Tick what you want**: per-category checkboxes (skills,
   agents, hooks, mcps). Plugin items are grouped by which
   plugin they came from so the user always knows the
   attribution.
4. **Confirm and write**: adopt copies the chosen items into the
   umbel artifact directory (frozen snapshots; the originals in
   `~/.claude/` stay untouched).
5. **Optional hand-off**: adopt then offers to launch `umbel init`
   so the user can compose a bundle from the freshly imported
   items right away.

## What it deliberately doesn't do

- Doesn't touch existing umbel functionality. `adopt` is a purely
  additive verb — every other umbel command behaves exactly as
  before. (Codified as acceptance criterion #11 in the design.)
- Doesn't edit existing bundle manifests. The hand-off to
  `umbel init` always produces a _new_ bundle.
- Doesn't modify or delete the user's `~/.claude/` source files.
  It only reads from them.
- Doesn't support non-`stdio` MCP servers, slash commands, or
  live mirroring in this first release. Those are surfaced as
  unimportable with a clear reason.

## Upgrading later

A small metadata sidecar (`.adopt-meta/<source>.json`) records
exactly which items adopt wrote into each source. When the user
wants to upgrade — for instance, after a plugin gets a new
version — they run `umbel adopt --refresh <source>`. Adopt then
deletes **only what it originally wrote** (never hand-rolled
files in the same bucket) and walks them through the wizard
again.

## How users discover it

- Listed in `umbel --help` like any other verb.
- `umbel list`, when there are no bundles and no adopted artifacts,
  prints a one-line hint pointing at `umbel adopt`.
- Added to the README quickstart as the first recommended step
  for users with an existing Claude Code installation.
- CHANGELOG entry under a new "Adopt" heading.

## Risk surface

- **New code path only** — bundle compile, resolve, and every
  existing verb are untouched. The full pre-existing test suite
  must keep passing as-is.
- **Robust scanner** — per-file errors become "unimportable"
  lines rather than aborts; the user always sees what's
  happening even when their source tree has broken artefacts.
- **No destructive defaults** — adopt never overwrites existing
  artifacts in a normal run; bulk re-import requires the
  explicit `--refresh` flag and a confirmation prompt that
  itemises what will be deleted.

## What we'd like sign-off on

1. The wizard flow (Origin → Scan + report → Source name →
   Optional plugin version pick → Per-category multi-select →
   Write + hand-off).
2. The reserved source-name convention (`claude`,
   `claude-project-<name>`, `cc-plugin-<marketplace>-<plugin>`)
   for adopt-managed buckets, with custom names allowed but
   accompanied by a warning.
3. The non-regression guarantee (acceptance criterion #11).
4. The MVP non-goals list (especially: no manifest editing,
   no live mirroring, no non-`stdio` MCP support).
