import { createHash } from "node:crypto";
import path from "node:path";
import { auth } from "@/lib/auth";

// Each account owns its own runtime files; never reuse the old global demo files.
export function webPetRuntime(userId: string) {
  const cwd = process.cwd();
  const root = cwd.includes(`${path.sep}.next`) ? cwd.split(`${path.sep}.next`)[0] : cwd;
  return path.join(root, ".runtime", "web-pets", createHash("sha256").update(userId).digest("hex"));
}

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
