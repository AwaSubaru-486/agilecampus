type TutorialDocument = Pick<Document, "querySelector" | "querySelectorAll">;

// The tutorial re-measures every 250 ms. If React has not re-rendered yet, a
// second automatic click would close the panel the first click just opened.
// Only one auto-open per control per second.
const AUTO_OPEN_COOLDOWN_MS = 1000;
const lastAutoOpen = new WeakMap<HTMLElement, number>();

function shouldAutoOpen(toggle: HTMLElement, now = Date.now()) {
  const previous = lastAutoOpen.get(toggle);
  if (previous !== undefined && now - previous < AUTO_OPEN_COOLDOWN_MS) return false;
  lastAutoOpen.set(toggle, now);
  return true;
}

function visible(element: HTMLElement) {
  const bounds = element.getBoundingClientRect();
  return bounds.width > 0 && bounds.height > 0;
}

export function findTutorialTarget(root: TutorialDocument, selector: string) {
  const candidates = [...root.querySelectorAll<HTMLElement>(selector)];
  const shown = candidates.find(visible);
  if (shown) return { element: shown, emptyTaskList: false };
  for (const candidate of candidates) {
    let parent = candidate.parentElement;
    while (parent) {
      if (parent.tagName === "DETAILS") (parent as HTMLDetailsElement).open = true;
      parent = parent.parentElement;
    }
    if (visible(candidate)) return { element: candidate, emptyTaskList: false };
  }
  if (selector === '[data-tour="conversation-title"]' || selector === '[data-tour="conversation-form"]') {
    // These targets are unmounted when closed. Only activate the explicitly
    // marked disclosure button, never a form submit button.
    const toggle = root.querySelector<HTMLButtonElement>('[data-tour="conversation-toggle"][aria-expanded="false"]');
    if (toggle && visible(toggle) && !toggle.disabled && toggle.getAttribute("aria-expanded") === "false" && shouldAutoOpen(toggle)) toggle.click();
  }
  if (selector === '[data-tour="console-task"]') {
    // Completed tasks are deliberately collapsed in the normal work area.
    const toggle = root.querySelector<HTMLButtonElement>('[data-tour="console-completed-toggle"]');
    if (toggle && visible(toggle) && toggle.getAttribute("aria-expanded") === "false") toggle.click();
    const list = root.querySelector<HTMLElement>('[data-tour="console-task-list"][data-tour-empty="true"]');
    if (list && visible(list)) return { element: list, emptyTaskList: true };
  }
  return { element: null, emptyTaskList: false };
}
