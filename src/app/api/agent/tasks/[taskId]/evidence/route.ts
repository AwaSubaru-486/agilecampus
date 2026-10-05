import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, mapAgentError, unauthorized } from "@/lib/agent-auth";
import { createEvidenceItem, EVIDENCE_TYPES } from "@/lib/evidence";

const schema = z.object({
  type: z.enum(EVIDENCE_TYPES),
  label: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(8_000),
  sourceId: z.uuid().nullable().optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
) {
  const userId = await authenticateBearer(request);
  if (!userId) return unauthorized();
  const { taskId } = await context.params;
  if (!z.uuid().safeParse(taskId).success) return NextResponse.json({ error: "taskId 无效" }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "参数无效" }, { status: 400 });
  try {
    const evidence = await createEvidenceItem(userId, taskId, parsed.data);
    return NextResponse.json({ id: evidence.id, type: evidence.type, label: evidence.label }, { status: 201 });
  } catch (error) {
    return mapAgentError(error, "[/api/agent/tasks/:id/evidence]");
  }
}
