import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { metaPath, readMeta, writeMeta } from "../../../src/adopt/meta.ts";
import type { AdoptMeta } from "../../../src/adopt/types.ts";
import { NotFoundError, UsageError } from "../../../src/errors.ts";

let artifactRoot: string;
beforeEach(() => {
  artifactRoot = mkdtempSync(join(tmpdir(), "umbel-adopt-meta-"));
});
afterEach(() => {
  rmSync(artifactRoot, { recursive: true, force: true });
});

const SAMPLE: AdoptMeta = {
  source: "claude",
  lastAdoptedAt: "2026-05-26T00:00:00Z",
  origin: { type: "global" },
  items: [
    { kind: "skills", leaf: "brainstorming" },
    { kind: "hooks", leaf: "log-bash" },
  ],
};

describe("meta sidecar", () => {
  it("metaPath joins .adopt-meta/<source>.json", () => {
    expect(metaPath(artifactRoot, "claude")).toBe(join(artifactRoot, ".adopt-meta", "claude.json"));
  });

  it("writeMeta creates the dir and writes valid JSON", () => {
    writeMeta(artifactRoot, SAMPLE);
    const raw = readFileSync(metaPath(artifactRoot, "claude"), "utf8");
    expect(JSON.parse(raw)).toEqual(SAMPLE);
  });

  it("readMeta round-trips", () => {
    writeMeta(artifactRoot, SAMPLE);
    expect(readMeta(artifactRoot, "claude")).toEqual(SAMPLE);
  });

  it("readMeta missing file → NotFoundError", () => {
    expect(() => readMeta(artifactRoot, "claude")).toThrow(NotFoundError);
  });

  it("readMeta malformed JSON → UsageError", () => {
    const p = metaPath(artifactRoot, "claude");
    writeMeta(artifactRoot, SAMPLE);
    writeFileSync(p, "{ not json");
    expect(() => readMeta(artifactRoot, "claude")).toThrow(UsageError);
  });

  it("readMeta validates shape (missing 'items' → UsageError)", () => {
    writeMeta(artifactRoot, SAMPLE);
    const p = metaPath(artifactRoot, "claude");
    writeFileSync(p, JSON.stringify({ source: "claude", origin: { type: "global" } }));
    expect(() => readMeta(artifactRoot, "claude")).toThrow(UsageError);
  });

  it("writeMeta does not create file when only writing the helper dir", () => {
    expect(existsSync(metaPath(artifactRoot, "other"))).toBe(false);
  });
});
