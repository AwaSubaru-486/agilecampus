import { z } from "zod";
import { authenticateDesktop, desktopHeartbeat, desktopState } from "@/lib/pets/desktop-session";
import { desktopFailure, desktopHeaders, desktopJson } from "@/lib/pets/desktop-http";
export async function GET(request: Request) {
  try { return Response.json(await desktopState(await authenticateDesktop(request)), { headers: desktopHeaders }); } catch (error) { return desktopFailure(error); }
}
export async function POST(request: Request) {
  try {
    const record = await authenticateDesktop(request);
    const input = z.object({ status: z.enum(["visible", "hidden", "stopped"]), ackSequence: z.number().int().nonnegative().optional() }).parse(await desktopJson(request));
    await desktopHeartbeat(record, input.status, input.ackSequence);
    return Response.json({ ok: true }, { headers: desktopHeaders });
  } catch (error) { return desktopFailure(error); }
}
