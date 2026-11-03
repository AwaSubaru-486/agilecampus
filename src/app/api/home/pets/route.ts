import { z } from "zod";
import { auth } from "@/lib/auth";
import { AppError, ForbiddenError } from "@/lib/errors";
import { ensureHome, selectHomePet } from "@/lib/home";
import { HOME_PET_CONTRACT_VERSION, homePetIdSchema } from "@/lib/pets/home-pet-contract";
import { listHomePets } from "@/lib/pets/home-pet-provider";

const headers = { "Cache-Control": "private, no-store" };
function failure(error: unknown) {
  if (error instanceof AppError) return Response.json({ error: error.message }, { status: error instanceof ForbiddenError ? 403 : 400, headers });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "桌宠参数或资源格式无效" }, { status: 400, headers });
  console.error("Home pet integration failed");
  return Response.json({ error: "桌宠服务暂不可用，请稍后重试" }, { status: 500, headers });
}
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401, headers });
  try {
    const [home, pets] = await Promise.all([ensureHome(session.user.id), listHomePets(session.user.id)]);
    return Response.json({ schemaVersion: HOME_PET_CONTRACT_VERSION, selectedPetId: home.pet.petId ?? null, pets }, { headers });
  } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401, headers });
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  if (origin && origin !== `${url.protocol}//${request.headers.get("host") ?? url.host}`)
    return Response.json({ error: "请求来源无效" }, { status: 403, headers });
  try {
    const { petId } = z.object({ petId: homePetIdSchema.nullable() }).parse(await request.json());
    const home = await selectHomePet(session.user.id, petId);
    return Response.json({ schemaVersion: HOME_PET_CONTRACT_VERSION, selectedPetId: home.pet.petId ?? null }, { headers });
  } catch (error) { return failure(error); }
}
