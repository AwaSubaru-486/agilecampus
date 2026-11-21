import type { IterationFeature, IterationModule, IterationOutcome } from "./iteration-types";

type Version = { id: string; baseIterationId: string | null; features: IterationFeature[]; moduleSnapshot: IterationModule[] | null; releaseUrl: string };

/** Legacy rows contain deltas. Resolve their explicit ancestry without rewriting history. */
export function iterationModules(version: Version | undefined, versions: Version[], seen = new Set<string>()): IterationModule[] {
  if (!version || seen.has(version.id)) return [];
  if (version.moduleSnapshot !== null) return version.moduleSnapshot.map(capability => ({ ...capability }));
  seen.add(version.id);
  const modules = iterationModules(versions.find(row => row.id === version.baseIterationId), versions, seen);
  for (const feature of version.features) {
    const index = modules.findIndex(capability => capability.id === feature.id || capability.name.toLowerCase() === feature.name.toLowerCase());
    const previous = modules[index];
    const capability = { id: previous?.id ?? feature.id, name: feature.name, summary: feature.summary, resultUrl: version.releaseUrl || previous?.resultUrl || "", context: previous?.context ?? "" };
    if (index < 0) modules.push(capability); else modules[index] = capability;
  }
  return modules;
}

export function moduleChanges(modules: IterationModule[], baseline: IterationModule[]): IterationFeature[] {
  return modules.flatMap(capability => {
    const before = baseline.find(item => item.id === capability.id);
    return !before || before.name !== capability.name || before.summary !== capability.summary || before.resultUrl !== capability.resultUrl
      ? [{ id: capability.id, name: capability.name, summary: capability.summary, change: before ? "improved" as const : "added" as const }] : [];
  });
}

export function iterationContext(version: { version: string; title: string; executionNotes: string }, modules: IterationModule[], baseline: IterationModule[], outcomes: IterationOutcome[] = []) {
  const changes = moduleChanges(modules, baseline);
  return [`# ${version.version} · ${version.title}`, "请在以下已有成果上继续开发。", ...modules.map(capability => {
    const before = baseline.find(item => item.id === capability.id);
    return [`## ${capability.name}${changes.some(item => item.id === capability.id) ? "（本轮修改）" : "（沿用）"}`, before ? `上一版：${before.summary}` : "上一版：尚无此模块", `当前：${capability.summary}`, capability.resultUrl && `成果：${capability.resultUrl}`, capability.context && `开发备注：${capability.context}`].filter(Boolean).join("\n");
  }), outcomes.length > 0 && ["## 已验收成果", ...outcomes.map(item => `- ${item.title}：${item.summary}${item.resultUrl ? `\n  ${item.resultUrl}` : ""}`)].join("\n"),
  version.executionNotes && `## 工作断点\n${version.executionNotes}`].filter(Boolean).join("\n\n");
}
