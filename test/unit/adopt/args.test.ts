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
