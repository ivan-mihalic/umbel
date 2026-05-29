import type { AdoptableItem } from "../types.ts";
import { type DirImporterOpts, scanNamedArtifactDir } from "./skills.ts";

export function scanAgents(opts: DirImporterOpts): AdoptableItem[] {
  return scanNamedArtifactDir({ ...opts, kind: "agents", mdFile: "AGENT.md" });
}
