import { AppError, NotFoundError } from "@/lib/errors";
import { authenticateDesktop } from "@/lib/pets/desktop-session";
import { readDesktopAsset } from "@/lib/pets/desktop-asset";
import { desktopFailure, desktopHeaders } from "@/lib/pets/desktop-http";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const record = await authenticateDesktop(request);
    const asset = await readDesktopAsset(record.userId);
    return new Response(new Uint8Array(asset.bytes), { headers: { ...desktopHeaders, "Content-Type": asset.mimeType, "X-Content-Type-Options": "nosniff", "X-Pet-Id": asset.petId } });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: error.message }, { status: 404, headers: desktopHeaders });
    if (error instanceof AppError) return desktopFailure(error);
    return desktopFailure(error);
  }
}
