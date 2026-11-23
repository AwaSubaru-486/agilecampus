import { auth } from "@/lib/auth";

// Each account owns its own runtime files; never reuse the old global demo files.
export { webPetRuntime } from "./web-pet-runtime";

export async function webPetActor(request?: Request): Promise<string | Response> {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401 });
  if (request && request.method !== "GET") {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (origin && origin !== `${url.protocol}//${request.headers.get("host") ?? url.host}`)) {
      return Response.json({ error: "请求来源无效" }, { status: 403 });
    }
  }
  return session.user.id;
}
