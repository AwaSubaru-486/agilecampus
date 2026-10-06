import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import { buildTutorialCourses, COURSE_IDS, INITIAL_TUTORIAL_PROGRESS, type TutorialProgress } from "./catalog";

export const tutorialCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("dismiss") }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("save"), courseId: z.enum(COURSE_IDS), step: z.number().int().min(0).max(200), projectId: z.uuid().nullable() }),
  z.object({ type: z.literal("complete"), courseId: z.enum(COURSE_IDS) }),
]);
export type TutorialCommand = z.infer<typeof tutorialCommandSchema>;

export async function getTutorialProgress(actorId: string): Promise<TutorialProgress> {
  const [user] = await db.select({ progress: users.tutorialProgress }).from(users).where(eq(users.id, actorId));
  if (!user) throw new ForbiddenError();
  return user.progress ?? INITIAL_TUTORIAL_PROGRESS;
}

export async function updateTutorialProgress(actorId: string, raw: unknown): Promise<TutorialProgress> {
  const command = tutorialCommandSchema.parse(raw);
  if (command.type === "save") {
    const access = command.projectId ? await getProjectForUser(actorId, command.projectId) : null;
    if (command.projectId && !access) throw new ForbiddenError();
    const project = access ? { id: access.project.id, name: access.project.name, teamId: access.project.teamId, role: access.role } : null;
    const course = buildTutorialCourses(project).find((item) => item.id === command.courseId);
    if (!course || course.needsProject && !project || course.roles && (!project || !course.roles.includes(project.role)) || command.step >= course.steps.length) throw new ForbiddenError();
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${actorId} for update`);
    const [user] = await tx.select({ progress: users.tutorialProgress }).from(users).where(eq(users.id, actorId));
    if (!user) throw new ForbiddenError();
    const current = user.progress ?? INITIAL_TUTORIAL_PROGRESS;
    const newlyCompleted: string[] = command.type === "complete" ? [command.courseId] : [];
    if (command.type === "complete" && command.courseId === "welcome" && current.active?.courseId === "welcome") {
      const access = current.active.projectId ? await getProjectForUser(actorId, current.active.projectId) : null;
      const project = access ? { id: access.project.id, name: access.project.name, teamId: access.project.teamId, role: access.role } : null;
      newlyCompleted.push(...buildTutorialCourses(project).filter((course) => (!course.needsProject || project) && (!course.roles || project && course.roles.includes(project.role))).map((course) => course.id));
    }
    const progress: TutorialProgress = command.type === "save" ? {
      ...current, status: "started", active: { courseId: command.courseId, step: command.step, projectId: command.projectId },
    } : command.type === "complete" ? {
      ...current, status: command.courseId === "welcome" ? "completed" : current.status === "new" ? "started" : current.status,
      active: null, completed: [...new Set([...current.completed, ...newlyCompleted])],
    } : { ...current, status: current.status === "new" ? "dismissed" : current.status,
      active: command.type === "pause" && current.active ? { ...current.active, paused: true } : null };
    await tx.update(users).set({ tutorialProgress: progress }).where(eq(users.id, actorId));
    return progress;
  });
}
