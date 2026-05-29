import { describe, expect, it } from "vitest";
import { isValidSlug, slugify } from "../../../src/adopt/slug.ts";

describe("slugify", () => {
  it("lowercases", () => {
    expect(slugify("Foo")).toBe("foo");
  });

  it("collapses runs of non-alnum to single dash", () => {
    expect(slugify("foo bar/baz_qux.lol")).toBe("foo-bar-baz-qux-lol");
  });

  it("trims leading and trailing dashes", () => {
    expect(slugify("--foo--")).toBe("foo");
    expect(slugify("@@@foo@@@")).toBe("foo");
  });

  it("collapses adjacent non-alnum runs to single dash", () => {
    expect(slugify("foo  ___  bar")).toBe("foo-bar");
  });

  it("non-ASCII passes through as non-alnum (no NFKD)", () => {
    expect(slugify("föö")).toBe("f");
    expect(slugify("Žluťoučký")).toBe("lu-ou-k");
  });

  it("returns empty string for input with no alnum", () => {
    expect(slugify("---@@@")).toBe("");
    expect(slugify("")).toBe("");
  });
});

describe("isValidSlug", () => {
  it("rejects empty", () => {
    expect(isValidSlug("")).toBe(false);
  });

  it("accepts simple alnum + dash", () => {
    expect(isValidSlug("foo")).toBe(true);
    expect(isValidSlug("foo-bar")).toBe(true);
    expect(isValidSlug("claude-project-foo")).toBe(true);
  });
});
