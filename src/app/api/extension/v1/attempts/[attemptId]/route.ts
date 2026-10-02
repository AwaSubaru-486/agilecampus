import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { updateAttempt } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ attemptId: string }> };

const updateAttemptSchema = z.object({
  state: z.enum(["started", "finished", "failed", "unknown"]).optional(),
  receipt: z.object({
    sessionId: z.string().nullable().optional(),
    headSha: z.string().nullable().optional(),
    changedPaths: z.array(z.string()).optional(),
    tests: z.array(z.object({
      commandLabel: z.string(),
      exitCode: z.number().nullable(),
      source: z.enum(["captured", "user-reported"]),
    })).optional(),
  }).optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { attemptId } = await ctx.params;
    if (!z.string().uuid().safeParse(attemptId).success) {
      return NextResponse.json({ error: "attemptId 无效" }, { status: 400 });
    }

    const body = await req.json();
    const input = updateAttemptSchema.parse(body);

    const updated = await updateAttempt(actorId, attemptId, input);
    return NextResponse.json(updated);
  } catch (error) {
    return mapExtensionError(error, "PATCH /api/extension/v1/attempts/[attemptId]");
  }
}
