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
    expect(scanAgents({ root: tmp, originGroup: "g", originLabel: "G" })).toEqual([]);
  });
});
