import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError } from "@/lib/extension-auth";
import { evaluateServerHandoffPreflight } from "@/lib/checkpoint";

type Ctx = { params: Promise<{ handoffId: string }> };

const preflightInputSchema = z.object({
  clientHeadSha: z.string().max(128).optional(),
  clientRepoKeyHash: z.string().max(128).optional(),
  clientDirty: z.boolean().optional(),
}).optional();

export async function POST(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { handoffId } = await ctx.params;
    if (!z.string().uuid().safeParse(handoffId).success) {
      return NextResponse.json({ error: "handoffId 无效" }, { status: 400 });
    }

    let clientInput: z.infer<typeof preflightInputSchema> = {};
    try {
      const json = await req.json();
      clientInput = preflightInputSchema.parse(json);
    } catch {
      // body is optional
    }

    const report = await evaluateServerHandoffPreflight(actorId, handoffId, clientInput);
    return NextResponse.json(report);
  } catch (error) {
    return mapExtensionError(error, "POST /api/extension/v1/handoffs/.../preflight");
  }
}
