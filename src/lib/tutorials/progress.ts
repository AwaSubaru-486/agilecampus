import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users, tasks, taskStages } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { listCollaborationHelp } from "@/lib/blocker";
import { getProjectForUser, listMyProjects } from "@/lib/project";
import { getTeamMembership } from "@/lib/team";
import { buildTutorialCourses, COURSE_IDS, INITIAL_TUTORIAL_PROGRESS, type TutorialProgress } from "./catalog";
import { EMPTY_JOURNEY, WELCOME_VERSION } from "./example-flow";
import { findShowcaseProject } from "./showcase";

export const tutorialCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("restart-example") }),
  z.object({ type: z.literal("dismiss") }), z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("save"), courseId: z.enum(COURSE_IDS), step: z.number().int().min(0).max(200), projectId: z.uuid().nullable() }),
  z.object({ type: z.literal("complete"), courseId: z.enum(COURSE_IDS) }),
]);
export type TutorialCommand = z.infer<typeof tutorialCommandSchema>;

function normalizeProgress(progress: TutorialProgress): TutorialProgress {
  if (progress.journey?.version === WELCOME_VERSION) return progress;
  // Step numbers from earlier walkthroughs refer to a different route.
  return {
    ...progress, journey: { ...EMPTY_JOURNEY },
    completed: progress.completed.filter(id => id !== "welcome"),
    status: progress.status === "completed" ? "started" : progress.status,
    active: progress.active?.courseId === "welcome"
      ? { courseId: "welcome", step: 0, projectId: null, paused: true, journeyVersion: WELCOME_VERSION } : progress.active,
  };
}

async function withShowcase(actorId: string, progress: TutorialProgress): Promise<TutorialProgress> {
  const accessible = await listMyProjects(actorId);
  const showcase = findShowcaseProject(accessible.map(project => ({ ...project, role: "student" as const })));
  const access = showcase ? await getProjectForUser(actorId, showcase.id) : null;
  if (!access) return { ...progress, journey: { ...EMPTY_JOURNEY } };
  const help = await listCollaborationHelp(actorId, access.project.id);
  const helpExample = help.find(request => request.taskId);
  const helpTaskId = helpExample?.taskId ?? null;
  const projectTasks = and(eq(tasks.projectId, access.project.id), eq(tasks.isTaskGroup, false));
  const sampleDelivery = (completedOnly: boolean) => db.select({ id: tasks.id, title: tasks.title, status: tasks.status }).from(tasks)
    .where(and(projectTasks, completedOnly ? eq(tasks.status, "done") : inArray(tasks.status, ["review", "done"]),
      access.role === "student" ? eq(tasks.assigneeId, actorId) : undefined))
    .orderBy(sql`(${tasks.status} = 'review') desc`, ...(helpTaskId ? [sql`${tasks.assigneeId} is distinct from (
      select source.assignee_id from tasks as source where source.id = ${helpTaskId} and source.project_id = ${access.project.id}
    )`] : []), sql`${tasks.submittedAt} desc nulls last`, asc(tasks.sortOrder), asc(tasks.id)).limit(1);
  const [[task], [reviewTask], [reviewedTask]] = await Promise.all([
    access.role === "teacher" ? [] : db.select({ id: tasks.id, title: tasks.title }).from(tasks)
      .leftJoin(taskStages, eq(tasks.stageId, taskStages.id))
      .where(and(projectTasks, access.role === "student" ? eq(tasks.assigneeId, actorId) : undefined))
      .orderBy(sql`${tasks.id} is distinct from ${helpTaskId}`, asc(taskStages.position), asc(tasks.sortOrder), asc(tasks.id)).limit(1),
    sampleDelivery(access.role === "teacher"),
    access.role === "admin" ? sampleDelivery(true) : [],
  ]);
  const changed = progress.journey?.projectId !== access.project.id || progress.journey.role !== access.role;
  return {
    ...progress,
    journey: {
      version: WELCOME_VERSION, teamId: access.project.teamId, projectId: access.project.id, role: access.role,
      taskId: task?.id ?? null, taskTitle: task?.title, helpTaskId, helpTaskTitle: helpExample?.taskTitle ?? undefined,
      acceptance: reviewTask ? { taskId: reviewTask.id, title: reviewTask.title, queue: reviewTask.status === "review" ? "review" : "completed" } : null,
      reviewedTask: reviewedTask ? { taskId: reviewedTask.id, title: reviewedTask.title } : null,
    },
    active: progress.active?.courseId === "welcome" ? {
      ...progress.active, projectId: access.project.id, journeyVersion: WELCOME_VERSION,
      ...(changed ? { step: 0, paused: true } : {}),
    } : progress.active,
  };
}

export async function getTutorialProgress(actorId: string): Promise<TutorialProgress> {
  const [user] = await db.select({ progress: users.tutorialProgress }).from(users).where(eq(users.id, actorId));
  if (!user) throw new ForbiddenError();
  return withShowcase(actorId, normalizeProgress(user.progress ?? INITIAL_TUTORIAL_PROGRESS));
}

export async function updateTutorialProgress(actorId: string, raw: unknown): Promise<TutorialProgress> {
  const command = tutorialCommandSchema.parse(raw);
  const access = command.type === "save" && command.projectId ? await getProjectForUser(actorId, command.projectId) : null;
  if (command.type === "save" && command.projectId && !access) throw new ForbiddenError();
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select id from users where id=${actorId} for update`);
    const [user] = await tx.select({ progress: users.tutorialProgress }).from(users).where(eq(users.id, actorId));
    if (!user) throw new ForbiddenError();
    const current = await withShowcase(actorId, normalizeProgress(user.progress ?? INITIAL_TUTORIAL_PROGRESS));
    const project = access ? { id: access.project.id, name: access.project.name, teamId: access.project.teamId, role: access.role } : null;
    if (command.type === "save") {
      const course = buildTutorialCourses(project, current.journey).find(course => course.id === command.courseId);
      if (!course || course.needsProject && !project || course.roles && (!project || !course.roles.includes(project.role)) || command.step >= course.steps.length) throw new ForbiddenError();
      if (command.courseId === "welcome" && command.projectId !== current.journey?.projectId) throw new ForbiddenError();
    }
    if (command.type === "restart-example" && !current.journey?.projectId) throw new ForbiddenError("请先加入展示项目所在团队");
    if (command.type === "complete" && command.courseId === "welcome") {
      const course = buildTutorialCourses(null, current.journey)[0];
      if (!current.journey?.projectId || current.active?.courseId !== "welcome" || current.active.step !== course.steps.length - 1) throw new ForbiddenError();
    }
    const progress: TutorialProgress = command.type === "restart-example" ? {
      ...current, status: "started", completed: current.completed.filter(id => id !== "welcome"),
      active: { courseId: "welcome", step: 0, projectId: current.journey!.projectId, journeyVersion: WELCOME_VERSION },
    } : command.type === "save" ? {
      ...current, status: "started", active: { courseId: command.courseId, step: command.step, projectId: command.projectId, ...(command.courseId === "welcome" ? { journeyVersion: WELCOME_VERSION } : {}) },
    } : command.type === "complete" ? {
      ...current, status: command.courseId === "welcome" ? "completed" : current.status === "new" ? "started" : current.status,
      active: null, completed: [...new Set([...current.completed, command.courseId])],
    } : {
      ...current, status: current.status === "new" ? "dismissed" : current.status,
      active: command.type === "pause" && current.active ? { ...current.active, paused: true } : null,
    };
    await tx.update(users).set({ tutorialProgress: progress }).where(eq(users.id, actorId));
    return progress;
  });
  return result;
}

// Kept for existing creation form callers; creating resources no longer changes the showcase.
export async function recordTutorialCreation(actorId: string, kind: "team" | "project", id: string) {
  const access = kind === "project" ? await getProjectForUser(actorId, id) : null;
  const membership = kind === "team" ? await getTeamMembership(actorId, id) : null;
  if (kind === "team" ? membership?.role !== "admin" : !access || access.role !== "admin") throw new ForbiddenError();
}
