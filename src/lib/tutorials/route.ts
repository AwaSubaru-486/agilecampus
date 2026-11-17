import type { TutorialStep } from "./catalog";

/** Keep the task the learner just chose while the next step explains its details. */
export function tutorialStepRoute(route: string, current: string) {
  const expected = new URL(route, "http://tutorial.local");
  const previous = new URL(current, "http://tutorial.local");
  const space = expected.searchParams.get("space");
  const task = previous.searchParams.get("task");
  if (
    task &&
    previous.pathname === expected.pathname &&
    (space === "work" || space === "studio") &&
    !expected.searchParams.has("task") &&
    !expected.searchParams.has("panel")
  ) {
    expected.searchParams.set("task", task);
  }
  return expected.pathname + expected.search + expected.hash;
}
/** Native dialogs don't survive navigation or reload. Let users reopen the original control. */
export function tutorialReopenStep(steps: readonly TutorialStep[], index: number) {
  const openers: Record<string, string> = {
    "timeline-inspector": "timeline-node",
    "timeline-close": "timeline-node",
    "evaluation-close": "teacher-evaluation",
    "help-close": "help-button",
  };
  const target = steps[index]?.target;
  const name = target?.match(/^\[data-tour="([\w-]+)"\]$/)?.[1];
  const opener = name && openers[name];
  if (!opener) return index;
  for (let i = index - 1; i >= 0; i--) {
    if (steps[i].route === steps[index].route && steps[i].target === `[data-tour="${opener}"]` && steps[i].action === "click") return i;
  }
  return index;
}
