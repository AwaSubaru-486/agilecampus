import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { buildProjectExport, renderProjectExportMarkdown } from "@/lib/project-export";

const formatSchema = z.enum(["json", "markdown"]).default("json");

function safeFilename(name: string) {
  return name.replace(/[^\p{L}\p{N}._-]+/gu, "-").slice(0, 80) || "agilecampus-project";
}

export async function GET(
  request: Request,
  context: { params: Promise<{ projectId: string }> },
) {
  const session = await auth();
  const actorId = session?.user?.id;
  if (!actorId) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  const { projectId } = await context.params;
  if (!z.uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "项目参数无效" }, { status: 400 });
  }

  const parsed = formatSchema.safeParse(new URL(request.url).searchParams.get("format") ?? undefined);
  if (!parsed.success) return NextResponse.json({ error: "format 只能是 json 或 markdown" }, { status: 400 });

  try {
    const pack = await buildProjectExport(actorId, projectId);
    const filename = safeFilename(pack.project.name);
    if (parsed.data === "markdown") {
      return new Response(renderProjectExportMarkdown(pack), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}.md"`,
        },
      });
    }
    return NextResponse.json(pack, {
      headers: {
        "Content-Disposition": `attachment; filename="${filename}.json"`,
      },
    });
  } catch (error) {
    if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("[project/export] 导出失败", error);
    return NextResponse.json({ error: "导出失败，请重试" }, { status: 500 });
  }
}
