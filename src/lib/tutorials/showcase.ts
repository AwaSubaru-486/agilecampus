import type { TutorialProject } from "./catalog";

export const SHOWCASE_TEAM = "敏捷开发演示小组";
export const SHOWCASE_PROJECT = "敏捷开发平台";
const LEGACY_SHOWCASE_TEAM = "汪汪队";

/** Use only accessible projects, preferring the populated namesake. */
export function findShowcaseProject(projects: TutorialProject[]) {
  const candidates = projects.filter(project => project.name === SHOWCASE_PROJECT && project.status !== "archived");
  const findInTeam = (team: string) => candidates.filter(project => project.teamName === team)
    .sort((a, b) => (b.taskTotal ?? 0) - (a.taskTotal ?? 0) || a.id.localeCompare(b.id))[0];
  return findInTeam(SHOWCASE_TEAM) ?? findInTeam(LEGACY_SHOWCASE_TEAM) ?? null;
}
