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
