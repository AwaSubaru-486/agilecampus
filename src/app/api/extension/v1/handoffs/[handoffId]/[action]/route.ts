import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { resolveHandoff } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ handoffId: string; action: string }> };

const actionBodySchema = z.object({
  reason: z.string().max(1000).optional(),
  expectedHandoffVersion: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().max(256).optional(),
}).optional();

export async function POST(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { handoffId, action } = await ctx.params;
    if (!z.string().uuid().safeParse(handoffId).success) {
      return NextResponse.json({ error: "handoffId 无效" }, { status: 400 });
    }

    if (action !== "accept" && action !== "decline" && action !== "withdraw") {
      return NextResponse.json({ error: "无效的交接动作，仅支持 accept, decline, withdraw" }, { status: 400 });
    }

    let body: z.infer<typeof actionBodySchema> = {};
    try {
      const json = await req.json();
      body = actionBodySchema.parse(json);
    } catch {
      // body is optional
    }

    const updated = await resolveHandoff(actorId, handoffId, action, {
      reason: body?.reason,
      expectedHandoffVersion: body?.expectedHandoffVersion,
    });
    return NextResponse.json(updated);
  } catch (error) {
    return mapExtensionError(error, `POST /api/extension/v1/handoffs/.../${ctx}`);
  }
}
