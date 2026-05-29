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
    expect(typeof validateClaudeProjectPath(join(tmp, "nope"), { home: tmp })).toBe("string");
  });
  it("returns error string when path lacks .claude/", () => {
    const proj = join(tmp, "naked");
    mkdirSync(proj, { recursive: true });
    expect(typeof validateClaudeProjectPath(proj, { home: tmp })).toBe("string");
  });
});
