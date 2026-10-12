import type { TutorialProject } from "./catalog";

export const SHOWCASE_TEAM = "汪汪队";
export const SHOWCASE_PROJECT = "敏捷开发平台";

/** Use only accessible projects, preferring the populated namesake. */
export function findShowcaseProject(projects: TutorialProject[]) {
  return projects
    .filter(project => project.teamName === SHOWCASE_TEAM && project.name === SHOWCASE_PROJECT)
    .sort((a, b) => (b.taskTotal ?? 0) - (a.taskTotal ?? 0) || a.id.localeCompare(b.id))[0] ?? null;
}
