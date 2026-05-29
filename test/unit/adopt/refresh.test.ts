import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaPath, writeMeta } from "../../../src/adopt/meta.ts";
import { executeRefresh, planRefresh } from "../../../src/adopt/refresh.ts";
import { NotFoundError } from "../../../src/errors.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-refresh-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("refresh", () => {
  it("planRefresh lists items in metadata and detects hand-rolled siblings", () => {
    mkdirSync(join(tmp, "skills", "claude", "managed"), { recursive: true });
    mkdirSync(join(tmp, "skills", "claude", "handrolled"), { recursive: true });
    writeMeta(tmp, {
      source: "claude",
      lastAdoptedAt: "2026-01-01T00:00:00Z",
      origin: { type: "global" },
      items: [{ kind: "skills", leaf: "managed" }],
    });
    const p = planRefresh(tmp, "claude");
    expect(p.toDelete).toEqual([{ kind: "skills", leaf: "managed" }]);
    expect(p.handRolledSiblings).toEqual([{ kind: "skills", leaf: "handrolled" }]);
  });

  it("missing metadata → NotFoundError", () => {
    expect(() => planRefresh(tmp, "claude")).toThrow(NotFoundError);
  });

  it("executeRefresh deletes listed items, preserves hand-rolled ones, soft-skips missing", () => {
    mkdirSync(join(tmp, "skills", "claude", "managed"), { recursive: true });
    mkdirSync(join(tmp, "skills", "claude", "handrolled"), { recursive: true });
    writeMeta(tmp, {
      source: "claude",
      lastAdoptedAt: "2026-01-01T00:00:00Z",
      origin: { type: "global" },
      items: [
        { kind: "skills", leaf: "managed" },
        { kind: "skills", leaf: "gone-already" }, // not on disk
      ],
    });
    executeRefresh(tmp, "claude");
    expect(existsSync(join(tmp, "skills", "claude", "managed"))).toBe(false);
    expect(existsSync(join(tmp, "skills", "claude", "handrolled"))).toBe(true);
    // Metadata file itself is removed; refresh re-writes it after successful re-import.
    expect(existsSync(metaPath(tmp, "claude"))).toBe(false);
  });
});
