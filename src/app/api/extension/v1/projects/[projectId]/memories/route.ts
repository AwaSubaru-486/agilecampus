import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateBearer, unauthorized, mapExtensionError, parseExtensionJson } from "@/lib/extension-auth";
import { createProjectMemory, listProjectMemories } from "@/lib/project-memory";
import type { MemoryCategory, MemoryStatus } from "@/db/schema";

type Ctx = { params: Promise<{ projectId: string }> };

const memoryCategorySchema = z.enum(["constraint", "decision", "learned", "rejected_approach"]);
const memoryStatusSchema = z.enum(["active", "needs_review", "superseded"]);

const createMemorySchema = z.object({
  taskId: z.string().uuid().nullable().optional(),
  category: memoryCategorySchema.default("constraint"),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(5000),
  codeRefSha: z.string().max(128).nullable().optional(),
});

export async function GET(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }

    const { searchParams } = new URL(req.url);
    const taskId = searchParams.get("taskId") || undefined;
    const statusParam = searchParams.get("status");
    const categoryParam = searchParams.get("category");

    const status = statusParam && memoryStatusSchema.safeParse(statusParam).success
      ? (statusParam as MemoryStatus)
      : undefined;
    const category = categoryParam && memoryCategorySchema.safeParse(categoryParam).success
      ? (categoryParam as MemoryCategory)
      : undefined;

    const memories = await listProjectMemories(actorId, projectId, {
      taskId,
      status,
      category,
    });

    return NextResponse.json(
      { memories },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return mapExtensionError(error, "GET /api/extension/v1/.../memories");
  }
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const actorId = await authenticateBearer(req);
    if (!actorId) return unauthorized();

    const { projectId } = await ctx.params;
    if (!z.string().uuid().safeParse(projectId).success) {
      return NextResponse.json({ error: "projectId 无效" }, { status: 400 });
    }

    const body = await parseExtensionJson(req);
    const input = createMemorySchema.parse(body);

    const memory = await createProjectMemory(actorId, projectId, input);
    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    return mapExtensionError(error, "POST /api/extension/v1/.../memories");
  }
}
