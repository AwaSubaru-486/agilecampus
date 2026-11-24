import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError, parseExtensionJson } from "@/lib/extension-auth";
import { createCheckpoint } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ projectId: string; taskId: string }> };

const materialSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["context", "transcript", "patch", "other"]),
  sha256: z.string().min(1).max(128),
  byteLength: z.number().int().nonnegative().max(5 * 1024 * 1024),
  transferred: z.boolean().default(false),
});

const sourceSchema = z.object({
  provider: z.string().min(1).max(100),
  providerVersion: z.string().min(1).max(50),
  captureMode: z.enum(["native", "context-only"]),
});

const summarySchema = z.object({
  goal: z.string().min(1).max(2000),
  completed: z.array(z.string().max(500)).max(50),
  remaining: z.array(z.string().max(500)).max(50),
  blocker: z.string().max(1000).nullable().default(null),
  nextAction: z.string().min(1).max(1000),
});

const createCheckpointSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  visibility: z.enum(["project", "assignee"]).default("project"),
  parentCheckpointId: z.string().uuid().nullable().optional(),
  taskHandoffVersion: z.number().int().nonnegative(),
  taskUpdatedAt: z.string(),
  repositoryKeyHash: z.string().min(1).max(128),
  headSha: z.string().min(1).max(128),
  source: sourceSchema,
  handoffSummary: summarySchema,
  materials: z.array(materialSchema).max(20).default([]),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId, taskId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }
    if (!z.string().uuid().safeParse(taskId).success) {
      return NextResponse.json({ error: "taskId 无效" }, { status: 400 });
    }

    const body = await parseExtensionJson(req);
    const input = createCheckpointSchema.parse(body);

    const checkpoint = await createCheckpoint(actorId, projectId, taskId, input);
    return NextResponse.json(checkpoint, { status: 201 });
  } catch (error) {
    return mapExtensionError(error, "POST /api/extension/v1/.../checkpoints");
  }
}
