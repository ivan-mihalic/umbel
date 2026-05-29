import type { ArtifactKind } from "../bundle/kinds.ts";
import type { GroupedOption } from "../ui/picker.ts";
import type { AdoptableItem } from "./types.ts";

export function buildAdoptPickerGroups(
  items: AdoptableItem[],
  kind: ArtifactKind,
): Record<string, GroupedOption<AdoptableItem>[]> {
  const groups: Record<string, GroupedOption<AdoptableItem>[]> = {};
  for (const it of items) {
    if (it.kind !== kind) continue;
    const opt: GroupedOption<AdoptableItem> = {
      value: it,
      label: renderLabel(it),
    };
    if (it.status === "already-imported") {
      opt.disabled = true;
      opt.hint = "already imported";
    } else if (it.status === "unimportable") {
      opt.disabled = true;
      opt.hint = it.reason ?? "cannot import";
    }
    if (!groups[it.originGroup]) groups[it.originGroup] = [];
    groups[it.originGroup]!.push(opt);
  }
  return groups;
}

export function hasAnyReady(items: AdoptableItem[]): boolean {
  return items.some((i) => i.status === "ready");
}

function renderLabel(it: AdoptableItem): string {
  if (it.status === "ready") return it.leaf;
  if (it.status === "already-imported") return `${it.leaf}  [already imported]`;
  return `${it.leaf}  [× ${it.reason ?? "cannot import"}]`;
}
