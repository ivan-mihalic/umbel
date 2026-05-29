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
