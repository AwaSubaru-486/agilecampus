import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ForbiddenError } from "@/lib/errors";
import { getProjectForUser } from "@/lib/project";
import {
  buildTutorialCourses,
  COURSE_IDS,
  INITIAL_TUTORIAL_PROGRESS,
  type TutorialProgress,
} from "./catalog";

import { applyExampleStep, EMPTY_EXAMPLE, EXAMPLE_FLOW } from "./example-flow";

export const tutorialCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("restart-example") }),
  z.object({ type: z.literal("dismiss") }),
  z.object({ type: z.literal("pause") }),
  z.object({
    type: z.literal("save"),
    courseId: z.enum(COURSE_IDS),
    step: z.number().int().min(0).max(200),
    projectId: z.uuid().nullable(),
  }),
  z.object({ type: z.literal("complete"), courseId: z.enum(COURSE_IDS) }),
]);
export type TutorialCommand = z.infer<typeof tutorialCommandSchema>;

export async function getTutorialProgress(
  actorId: string,
): Promise<TutorialProgress> {
  const [user] = await db
    .select({ progress: users.tutorialProgress })
    .from(users)
    .where(eq(users.id, actorId));
  if (!user) throw new ForbiddenError();
  return normalizeProgress(user.progress ?? INITIAL_TUTORIAL_PROGRESS);
}

function normalizeProgress(progress: TutorialProgress): TutorialProgress {
  const current =
    !progress.example && progress.completed.includes("welcome")
      ? {
          ...progress,
          status:
            progress.status === "completed"
              ? ("started" as const)
              : progress.status,
          completed: progress.completed.filter((id) => id !== "welcome"),
        }
      : progress;
  if (
    current.active?.courseId === "welcome" &&
    current.active.journeyVersion !== 2
  ) {
    return {
      ...current,
      active: {
        courseId: "welcome",
        step: 0,
        projectId: null,
        paused: true,
        journeyVersion: 2,
      },
    };
  }
  return current;
}

export async function updateTutorialProgress(
  actorId: string,
  raw: unknown,
): Promise<TutorialProgress> {
  const command = tutorialCommandSchema.parse(raw);
  if (command.type === "save") {
    const access = command.projectId
      ? await getProjectForUser(actorId, command.projectId)
      : null;
    if (command.projectId && !access) throw new ForbiddenError();
    const project = access
      ? {
          id: access.project.id,
          name: access.project.name,
          teamId: access.project.teamId,
          role: access.role,
        }
      : null;
    const course = buildTutorialCourses(project).find(
      (item) => item.id === command.courseId,
    );
    if (
      !course ||
      (course.needsProject && !project) ||
      (course.roles && (!project || !course.roles.includes(project.role))) ||
      command.step >= course.steps.length
    )
      throw new ForbiddenError();
  }
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from users where id = ${actorId} for update`,
    );
    const [user] = await tx
      .select({ progress: users.tutorialProgress })
      .from(users)
      .where(eq(users.id, actorId));
    if (!user) throw new ForbiddenError();
    const current = normalizeProgress(
      user.progress ?? INITIAL_TUTORIAL_PROGRESS,
    );
    if (
      command.type === "save" &&
      command.courseId === "welcome" &&
      command.step > (current.example?.phase ?? 0)
    )
      throw new Error("请先完成示例操作");
    if (
      command.type === "complete" &&
      command.courseId === "welcome" &&
      (current.example?.phase ?? 0) < EXAMPLE_FLOW.length
    )
      throw new Error("请先完成示例项目");
    const newlyCompleted: string[] =
      command.type === "complete" ? [command.courseId] : [];
    const progress: TutorialProgress =
      command.type === "restart-example"
        ? {
            ...current,
            status: "started",
            example: EMPTY_EXAMPLE,
            completed: current.completed.filter((id) => id !== "welcome"),
            active: {
              courseId: "welcome",
              step: 0,
              projectId: null,
              journeyVersion: 2,
            },
          }
        : command.type === "save"
          ? {
              ...current,
              status: "started",
              active: {
                courseId: command.courseId,
                step: command.step,
                projectId:
                  command.courseId === "welcome" ? null : command.projectId,
                ...(command.courseId === "welcome"
                  ? { journeyVersion: 2 }
                  : {}),
              },
            }
          : command.type === "complete"
            ? {
                ...current,
                status:
                  command.courseId === "welcome"
                    ? "completed"
                    : current.status === "new"
                      ? "started"
                      : current.status,
                active: null,
                completed: [
                  ...new Set([...current.completed, ...newlyCompleted]),
                ],
              }
            : {
                ...current,
                status: current.status === "new" ? "dismissed" : current.status,
                active:
                  command.type === "pause" && current.active
                    ? { ...current.active, paused: true }
                    : null,
              };
    await tx
      .update(users)
      .set({ tutorialProgress: progress })
      .where(eq(users.id, actorId));
    return progress;
  });
}

export async function updateTutorialExample(
  actorId: string,
  phase: number,
  values: Record<string, string>,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id=${actorId} for update`);
    const [user] = await tx
      .select({ progress: users.tutorialProgress })
      .from(users)
      .where(eq(users.id, actorId));
    if (!user) throw new ForbiddenError();
    const current = normalizeProgress(
      user.progress ?? INITIAL_TUTORIAL_PROGRESS,
    );
    const example = applyExampleStep(
      current.example ?? EMPTY_EXAMPLE,
      phase,
      values,
      new Date().toISOString(),
    );
    await tx
      .update(users)
      .set({ tutorialProgress: { ...current, example } })
      .where(eq(users.id, actorId));
    return example;
  });
}
