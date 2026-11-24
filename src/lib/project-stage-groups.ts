export function groupTasksByStage<T extends { stageId: string | null }>(
  stages: { id: string; title: string }[], tasks: T[],
) {
  const groups = stages.map((stage, index) => ({
    id: stage.id, label: `阶段 ${index + 1}`, title: stage.title,
    tasks: tasks.filter(task => task.stageId === stage.id),
  }));
  const known = new Set(stages.map(stage => stage.id));
  const ungrouped = tasks.filter(task => !task.stageId || !known.has(task.stageId));
  if (ungrouped.length) groups.push({ id: "unstaged", label: "未分阶段", title: "待组长安排阶段", tasks: ungrouped });
  return groups;
}
