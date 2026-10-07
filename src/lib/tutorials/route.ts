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
