import { z } from "zod";
import { auth } from "@/lib/auth";
import { commandDesktop, createDesktopPairing, desktopStatus } from "@/lib/pets/desktop-session";
import { desktopFailure, desktopHeaders, desktopJson, desktopSameOrigin } from "@/lib/pets/desktop-http";
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401, headers: desktopHeaders });
  try { return Response.json(await desktopStatus(session.user.id), { headers: desktopHeaders }); } catch (error) { return desktopFailure(error); }
}
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "请先登录" }, { status: 401, headers: desktopHeaders });
  if (!desktopSameOrigin(request)) return Response.json({ error: "请求来源无效" }, { status: 403, headers: desktopHeaders });
  try {
    const { operation } = z.object({ operation: z.enum(["connect", "show", "hide", "quit", "disconnect"]) }).parse(await desktopJson(request));
    if (operation === "connect") {
      const url = new URL(request.url);
      const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
      return Response.json(await createDesktopPairing(session.user.id, origin), { headers: desktopHeaders });
    }
    await commandDesktop(session.user.id, operation);
    return Response.json({ accepted: true }, { headers: desktopHeaders });
  } catch (error) { return desktopFailure(error); }
}
