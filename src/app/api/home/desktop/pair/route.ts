import { z } from "zod";
import { consumeDesktopPairing } from "@/lib/pets/desktop-session";
import { desktopFailure, desktopHeaders, desktopJson } from "@/lib/pets/desktop-http";
export async function POST(request: Request) {
  try {
    const { ticket } = z.object({ ticket: z.string().max(100) }).parse(await desktopJson(request));
    return Response.json(await consumeDesktopPairing(ticket), { headers: desktopHeaders });
  } catch (error) { return desktopFailure(error); }
}
