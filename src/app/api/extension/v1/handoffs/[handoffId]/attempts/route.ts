import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError, parseExtensionJson } from "@/lib/extension-auth";
import { createAttempt } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ handoffId: string }> };

const createAttemptSchema = z.object({
  baseSha: z.string().min(1).max(128),
  branchName: z.string().max(256).nullable().optional(),
  kind: z.enum(["continuation", "parallel"]).default("continuation"),
  provider: z.string().max(100).default("codex-cli"),
  providerVersion: z.string().max(50).default("1.0.0"),
  receipt: z.object({
    sessionId: z.string().nullable().default(null),
    headSha: z.string().nullable().default(null),
    changedPaths: z.array(z.string()).default([]),
    tests: z.array(z.object({
      commandLabel: z.string(),
      exitCode: z.number().nullable(),
      source: z.enum(["captured", "user-reported"]),
    })).default([]),
  }).optional(),
});

export async function POST(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { handoffId } = await ctx.params;
    if (!z.string().uuid().safeParse(handoffId).success) {
      return NextResponse.json({ error: "handoffId 无效" }, { status: 400 });
    }

    const body = await parseExtensionJson(req);
    const input = createAttemptSchema.parse(body);

    const attempt = await createAttempt(actorId, handoffId, input);
    return NextResponse.json(attempt, { status: 201 });
  } catch (error) {
    return mapExtensionError(error, "POST /api/extension/v1/handoffs/.../attempts");
  }
}
