import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { freezeContextPack } from "@/lib/context-pack";

function errorResponse(error: unknown) {
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 400 });
  console.error("[context-pack/freeze] 请求失败", error);
  return NextResponse.json({ error: "冻结失败，请重试" }, { status: 500 });
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ packId: string }> },
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { packId } = await context.params;
  if (!z.uuid().safeParse(packId).success) {
    return NextResponse.json({ error: "上下文包参数无效" }, { status: 400 });
  }
  try {
    return NextResponse.json({ pack: await freezeContextPack(session.user.id, packId) });
  } catch (error) {
    return errorResponse(error);
  }
}
