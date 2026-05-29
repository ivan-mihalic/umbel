import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../../src/run.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-list-hint-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("umbel list — empty-state hint", () => {
  it("prints the adopt nudge when no bundles + no artifacts exist", async () => {
    const out: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    });
    await run(["list"], { UMBEL_ARTIFACTS_DIR: tmp, HOME: tmp }, tmp);
    expect(out.join("")).toMatch(/umbel adopt/);
  });
});
