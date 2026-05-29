import { describe, expect, it } from "vitest";
import { buildAdoptPickerGroups, hasAnyReady } from "../../../src/adopt/picker.ts";
import type { AdoptableItem } from "../../../src/adopt/types.ts";

function it_(
  kind: AdoptableItem["kind"],
  leaf: string,
  status: AdoptableItem["status"],
  grp = "claude",
): AdoptableItem {
  return {
    kind,
    leaf,
    originGroup: grp,
    originLabel: grp,
    source: { type: "dir", path: "/x" },
    status,
  };
}

describe("buildAdoptPickerGroups", () => {
  it("groups by originGroup with disabled flag for non-ready items", () => {
    const items = [
      it_("skills", "a", "ready"),
      it_("skills", "b", "already-imported"),
      it_("skills", "c", "unimportable", "claude"),
    ];
    const groups = buildAdoptPickerGroups(items, "skills");
    expect(Object.keys(groups)).toEqual(["claude"]);
    const claude = groups.claude!;
    expect(claude.map((o) => o.value.leaf)).toEqual(["a", "b", "c"]);
    expect(claude.find((o) => o.value.leaf === "b")?.disabled).toBe(true);
    expect(claude.find((o) => o.value.leaf === "c")?.disabled).toBe(true);
  });

  it("filters by kind", () => {
    const items = [it_("skills", "s1", "ready"), it_("agents", "a1", "ready")];
    expect(Object.values(buildAdoptPickerGroups(items, "agents")).flat()).toHaveLength(1);
  });
});

describe("hasAnyReady", () => {
  it("true when any item is ready", () => {
    expect(hasAnyReady([it_("skills", "a", "ready")])).toBe(true);
  });
  it("false when every item is non-ready", () => {
    expect(
      hasAnyReady([it_("skills", "a", "already-imported"), it_("skills", "b", "unimportable")]),
    ).toBe(false);
  });
});
