type TutorialDocument = Pick<Document, "querySelector" | "querySelectorAll">;

function visible(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

export function findTutorialTarget(root: TutorialDocument, selector: string) {
  const element = [...root.querySelectorAll<HTMLElement>(selector)].find(visible);
  if (element) return { element, emptyTaskList: false };
  if (selector === '[data-tour="console-task"]') {
    // Completed tasks are deliberately collapsed in the normal work area.
    const toggle = root.querySelector<HTMLButtonElement>('[data-tour="console-completed-toggle"]');
    if (toggle && visible(toggle) && toggle.getAttribute("aria-expanded") === "false") toggle.click();
    const list = root.querySelector<HTMLElement>('[data-tour="console-task-list"][data-tour-empty="true"]');
    if (list && visible(list)) return { element: list, emptyTaskList: true };
  }
  return { element: null, emptyTaskList: false };
}
