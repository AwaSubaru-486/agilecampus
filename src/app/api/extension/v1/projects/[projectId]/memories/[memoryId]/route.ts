import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError, parseExtensionJson } from "@/lib/extension-auth";
import { updateProjectMemoryStatus } from "@/lib/project-memory";
import type { MemoryStatus } from "@/db/schema";

type Ctx = { params: Promise<{ projectId: string; memoryId: string }> };

const memoryStatusSchema = z.enum(["active", "needs_review", "superseded"]);

const updateMemorySchema = z.object({
  status: memoryStatusSchema,
  supersededById: z.string().uuid().nullable().optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId, memoryId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }
    if (!z.string().uuid().safeParse(memoryId).success) {
      return NextResponse.json({ error: "memoryId 无效" }, { status: 400 });
    }

    const body = await parseExtensionJson(req);
    const input = updateMemorySchema.parse(body);

    const updated = await updateProjectMemoryStatus(
      actorId,
      memoryId,
      input.status as MemoryStatus,
      input.supersededById ?? undefined,
    );

    return NextResponse.json(updated);
  } catch (error) {
    return mapExtensionError(error, "PATCH /api/extension/v1/.../memories/:id");
  }
}
