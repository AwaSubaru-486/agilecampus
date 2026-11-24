"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { listConsoleEvents, listConsoleRuns } from "@/lib/collaboration-console";
import { AppError, ForbiddenError } from "@/lib/errors";

type HistoryPage<T> = {
  ok: true;
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
} | { ok: false; error: string };
const pageInputSchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid(),
  cursor: z.string().min(1).max(1024),
});

async function requireActor() {
  const session = await auth();
  if (!session?.user?.id) throw new AppError("请先登录后查看项目记录");
  return session.user.id;
}

export async function loadConsoleRunsPage(
  projectId: string,
  taskId: string,
  cursor: string,
): Promise<HistoryPage<{
  id: string;
  agentId: string;
  agentName: string | null;
  status: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}>> {
  try {
    const input = pageInputSchema.parse({ projectId, taskId, cursor });
    const actorId = await requireActor();
    const page = await listConsoleRuns(actorId, input.projectId, input.taskId, { cursor: input.cursor });
    return {
      ok: true,
      items: page.items.map((run) => ({
        id: run.id,
        agentId: run.agentId,
        agentName: run.agentName ?? null,
        status: run.status,
        createdAt: run.createdAt.toISOString(),
        startedAt: run.startedAt?.toISOString() ?? null,
        finishedAt: run.finishedAt?.toISOString() ?? null,
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: "分页参数无效" };
    if (error instanceof AppError || error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
}

export async function loadConsoleEventsPage(
  projectId: string,
  taskId: string,
  cursor: string,
): Promise<HistoryPage<{
  id: string;
  type: string;
  summary: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string;
  }>> {
  try {
    const input = pageInputSchema.parse({ projectId, taskId, cursor });
    const actorId = await requireActor();
    const page = await listConsoleEvents(actorId, input.projectId, input.taskId, { cursor: input.cursor });
    return {
      ok: true,
      items: page.items.map((event) => ({
        id: event.id,
        type: event.type,
        summary: event.summary,
        actorId: event.actorId ?? null,
        actorName: event.actorName ?? null,
        createdAt: event.createdAt.toISOString(),
      })),
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
    };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: "分页参数无效" };
    if (error instanceof AppError || error instanceof ForbiddenError) return { ok: false, error: error.message };
    throw error;
  }
}
