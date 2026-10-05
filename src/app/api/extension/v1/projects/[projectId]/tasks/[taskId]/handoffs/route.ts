import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError, parseExtensionJson } from "@/lib/extension-auth";
import { createHandoff } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ projectId: string; taskId: string }> };

const createHandoffSchema = z.object({
  checkpointId: z.string().uuid(),
  toUserId: z.string().uuid(),
  expectedTaskUpdatedAt: z.string().datetime(),
  expectedHandoffVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().min(1).max(256),
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
    const input = createHandoffSchema.parse(body);

    const { record, isNew } = await createHandoff(actorId, projectId, taskId, input);
    return NextResponse.json(record, { status: isNew ? 201 : 200 });
  } catch (error) {

    return mapExtensionError(error, "POST /api/extension/v1/.../handoffs");
  }
}
