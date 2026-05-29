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
