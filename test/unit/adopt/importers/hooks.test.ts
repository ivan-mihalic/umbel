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
    expect(scanHooks({ root: tmp, ...G, mode: "direct" })[0]?.status).toBe("unimportable");
  });

  it("inline command leaf = '<slug32>-<hash4>', deterministic across re-runs", () => {
    writeFileSync(
      join(tmp, "settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "echo hello world" }] }],
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
            hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/hooks/log.sh" }],
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
            hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/lib/runner.sh" }],
          },
        ],
      }),
    );
    const items = scanHooks({ root: tmp, ...G, mode: "plugin" });
    expect(items[0]?.status).toBe("ready");
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
            hooks: [{ type: "command", command: "${CLAUDE_PLUGIN_ROOT}/lib/ghost.sh" }],
          },
        ],
      }),
    );
    const items = scanHooks({ root: tmp, ...G, mode: "plugin" });
    expect(items[0]?.status).toBe("unimportable");
    expect(items[0]?.reason).toMatch(/missing plugin file/);
  });
});
