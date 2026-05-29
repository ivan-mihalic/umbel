import { confirm, note, select, text } from "@clack/prompts";
import { listCachedPlugins, pickRecommendedVersion } from "../adopt/importers/plugins.ts";
import { defaultSourceNameFor, resolveOrigin } from "../adopt/origin.ts";
import { buildAdoptPickerGroups, hasAnyReady } from "../adopt/picker.ts";
import { buildPlan } from "../adopt/plan.ts";
import { scan } from "../adopt/scan.ts";
import { isValidSlug, slugify } from "../adopt/slug.ts";
import type { AdoptableItem, ResolvedOrigin } from "../adopt/types.ts";
import { writePlan } from "../adopt/write.ts";
import { projectBundlesDir, userBundlesDir } from "../bundle/env.ts";
import { ARTIFACT_KINDS, type ArtifactKind } from "../bundle/kinds.ts";
import { expandHomePath, validateClaudeProjectPath } from "./path-prompt.ts";
import { pickGrouped } from "./picker.ts";
import { assertSelected } from "./prompt.ts";

export interface AdoptWizardCtx {
  cwd: string;
  home: string;
  artifactRoot: string;
  dryRun: boolean;
  refreshOrigin?: ResolvedOrigin;
}

export async function runAdoptWizard(ctx: AdoptWizardCtx): Promise<number> {
  const origin = await chooseOrigin(ctx);
  const versionByGroup = await maybePickPluginVersions(origin, ctx);
  const sourceName = await chooseSourceName(origin);
  const report = scan(origin, {
    artifactRoot: ctx.artifactRoot,
    sourceName,
    pluginVersionByGroup: versionByGroup,
  });
  emitReport(report);

  if (!hasAnyReadyAnywhere(report.importable)) {
    note("Nothing to import from this origin. (See report above for unimportable items.)");
    return 0;
  }

  const selected = await runPickers(report.importable);

  const plan = buildPlan({
    origin,
    defaultSourceName: sourceName,
    selected,
    artifactRoot: ctx.artifactRoot,
  });

  if (ctx.dryRun) {
    note(renderDryRun(plan));
    return 0;
  }

  const proceed = assertSelected(
    await confirm({
      message: `Will write ${plan.items.length} artifacts. Proceed?`,
      initialValue: true,
    }),
  );
  if (!proceed) return 0;

  writePlan(plan, { artifactRoot: ctx.artifactRoot });
  note(`wrote ${plan.items.length} artifacts`);

  const goInit = assertSelected(
    await confirm({
      message: "Run 'umbel init' now to put them in a bundle?",
      initialValue: true,
    }),
  );
  if (goInit) {
    const { runInitWizard } = await import("./bundle-init.ts");
    const code = await runInitWizard({
      userBundlesDir: userBundlesDir(process.env),
      projectBundlesDir: projectBundlesDir(ctx.cwd, ctx.home),
      cwd: ctx.cwd,
      home: ctx.home,
      artifactRoots: {
        skills: `${ctx.artifactRoot}/skills`,
        agents: `${ctx.artifactRoot}/agents`,
      },
    });
    return code;
  }
  note("Tip: run 'umbel init' later to compose a bundle from these artifacts.");
  return 0;
}

async function chooseOrigin(ctx: AdoptWizardCtx): Promise<ResolvedOrigin> {
  if (ctx.refreshOrigin) return ctx.refreshOrigin;
  const kind = assertSelected(
    await select<"global" | "project">({
      message: "Where do you want to import from?",
      options: [
        {
          label: "Global  (~/.claude — direct items + ALL plugins in plugins/cache)",
          value: "global",
        },
        { label: "Project (you'll provide a path — direct items only)", value: "project" },
      ],
    }),
  );
  if (kind === "global") return resolveOrigin({ kind: "global" }, { home: ctx.home });
  const path = assertSelected(
    await text({
      message: "Project path",
      placeholder: ctx.cwd,
      initialValue: ctx.cwd,
      validate: (v) => validateClaudeProjectPath(v ?? "", { home: ctx.home }),
    }),
  );
  return resolveOrigin(
    { kind: "project", path: expandHomePath(path, ctx.home) },
    { home: ctx.home },
  );
}

async function maybePickPluginVersions(
  origin: ResolvedOrigin,
  _ctx: AdoptWizardCtx,
): Promise<Record<string, string>> {
  if (origin.kind !== "global") return {};
  const groups = listCachedPlugins(`${origin.root}/plugins/cache`);
  const multi = groups.filter((g) => g.versions.length > 1);
  if (multi.length === 0) {
    const auto: Record<string, string> = {};
    for (const g of groups) {
      if (g.versions[0] !== undefined) auto[`${g.marketplace}-${g.plugin}`] = g.versions[0];
    }
    return auto;
  }
  const out: Record<string, string> = {};
  for (const g of groups) {
    if (g.versions.length === 1 && g.versions[0] !== undefined) {
      out[`${g.marketplace}-${g.plugin}`] = g.versions[0];
      continue;
    }
    const rec = pickRecommendedVersion(g.versions);
    const choice = assertSelected(
      await select<string>({
        message: `Plugin ${g.marketplace}/${g.plugin} has ${g.versions.length} versions`,
        options: g.versions.map((v) => ({
          value: v,
          label: rec !== null && v === rec ? `${v}  (recommended: newest)` : v,
        })),
      }),
    );
    out[`${g.marketplace}-${g.plugin}`] = choice;
  }
  return out;
}

async function chooseSourceName(origin: ResolvedOrigin): Promise<string> {
  if (origin.kind === "plugin") return defaultSourceNameFor(origin);
  const def = defaultSourceNameFor(origin);
  const raw = assertSelected(
    await text({
      message: "Adopt direct .claude/ items under source name",
      initialValue: def,
      validate: (v) => (isValidSlug(slugify(v ?? "")) ? undefined : "slug must be non-empty"),
    }),
  );
  return slugify(raw);
}

function emitReport(report: ReturnType<typeof scan>): void {
  const counts: Record<ArtifactKind, number> = { skills: 0, agents: 0, hooks: 0, mcps: 0 };
  for (const it of report.importable) counts[it.kind] += 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  note(
    `Importable: ${total}\n  skills: ${counts.skills}   agents: ${counts.agents}   hooks: ${counts.hooks}   mcps: ${counts.mcps}\nNot importable: ${report.unimportable.length}\n${report.unimportable
      .map((u) => `  • ${u.kind}/${u.leaf}  ${u.reason ?? ""}`)
      .join("\n")}`,
  );
}

function hasAnyReadyAnywhere(items: AdoptableItem[]): boolean {
  return ARTIFACT_KINDS.some((k) => hasAnyReady(items.filter((i) => i.kind === k)));
}

async function runPickers(items: AdoptableItem[]): Promise<AdoptableItem[]> {
  const picked: AdoptableItem[] = [];
  for (const kind of ARTIFACT_KINDS) {
    const groups = buildAdoptPickerGroups(items, kind);
    const ofKind = items.filter((i) => i.kind === kind);
    if (ofKind.length === 0) continue;
    if (!hasAnyReady(ofKind)) continue;
    const v = await pickGrouped<AdoptableItem>({
      message: `Select ${kind} to import:`,
      groups,
      required: false,
    });
    for (const it of v) picked.push(it);
  }
  return picked;
}

function renderDryRun(plan: ReturnType<typeof buildPlan>): string {
  const lines = plan.items.map((p) => `  ${p.item.kind}/${p.sourceName}/${p.item.leaf}`);
  return `Would write ${plan.items.length} artifacts:\n${lines.join("\n")}`;
}
