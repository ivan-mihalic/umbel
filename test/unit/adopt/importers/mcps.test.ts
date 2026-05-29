import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanMcps } from "../../../../src/adopt/importers/mcps.ts";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "umbel-mcps-imp-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const G = { originGroup: "g", originLabel: "G" };

describe("scanMcps", () => {
  it("reads stdio mcpServers from .mcp.json", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { atlassian: { command: "uvx", args: ["atlassian-mcp"] } } }),
    );
    const items = scanMcps({ root: tmp, ...G });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "mcps", leaf: "atlassian", status: "ready" });
  });

  it("marks http transport unimportable", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { remote: { type: "http", url: "https://x" } } }),
    );
    const items = scanMcps({ root: tmp, ...G });
    expect(items[0]).toMatchObject({ status: "unimportable" });
    expect(items[0]?.reason).toMatch(/stdio/i);
  });

  it("marks missing command unimportable", () => {
    writeFileSync(
      join(tmp, ".mcp.json"),
      JSON.stringify({ mcpServers: { broken: { type: "stdio" } } }),
    );
    expect(scanMcps({ root: tmp, ...G })[0]?.status).toBe("unimportable");
  });

  it("malformed .mcp.json yields one synthetic unimportable line", () => {
    writeFileSync(join(tmp, ".mcp.json"), "{ not json");
    const items = scanMcps({ root: tmp, ...G });
    expect(items).toHaveLength(1);
    expect(items[0]?.status).toBe("unimportable");
    expect(items[0]?.reason).toMatch(/JSON|Unexpected/i);
  });

  it("settings.json mcpServers also picked up", () => {
    mkdirSync(tmp, { recursive: true });
    writeFileSync(
      join(tmp, "settings.json"),
      JSON.stringify({ mcpServers: { fs: { command: "fs-mcp" } } }),
    );
    const items = scanMcps({ root: tmp, ...G });
    expect(items.map((i) => i.leaf)).toContain("fs");
  });

  it("empty mcpServers section → no items, no error", () => {
    writeFileSync(join(tmp, ".mcp.json"), JSON.stringify({ mcpServers: null }));
    expect(scanMcps({ root: tmp, ...G })).toEqual([]);
  });

  it("no .mcp.json and no settings.json → empty", () => {
    expect(scanMcps({ root: tmp, ...G })).toEqual([]);
  });
});
