import { describe, expect, it } from "vitest";
import type {
  AdoptMeta,
  AdoptableItem,
  ImportPlan,
  ImporterSource,
  PlannedWrite,
  ResolvedOrigin,
  ScanReport,
} from "../../../src/adopt/types.ts";

describe("adopt types", () => {
  it("AdoptableItem accepts a ready skill", () => {
    const item: AdoptableItem = {
      kind: "skills",
      leaf: "brainstorming",
      originGroup: "claude-plugins-official-superpowers@5.2.0",
      originLabel: "claude-plugins-official/superpowers@5.2.0",
      source: { type: "dir", path: "/abs/skill/dir" },
      status: "ready",
    };
    expect(item.status).toBe("ready");
  });

  it("AdoptMeta accepts a global origin", () => {
    const meta: AdoptMeta = {
      source: "claude",
      lastAdoptedAt: "2026-05-26T00:00:00Z",
      origin: { type: "global" },
      items: [{ kind: "skills", leaf: "x" }],
    };
    expect(meta.origin.type).toBe("global");
  });

  it("ImporterSource discriminates by type", () => {
    const s: ImporterSource = { type: "dir", path: "/x" };
    expect(s.type).toBe("dir");
  });
});

type _Static = ScanReport | ImportPlan | PlannedWrite | ResolvedOrigin;
