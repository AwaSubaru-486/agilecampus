import { NextResponse } from "next/server";
import { setProjectView } from "@/app/(app)/projects/[projectId]/_shared/project-view-actions";

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await context.params;
  try {
    if (new URL(request.headers.get("origin") ?? "").host !== request.headers.get("host")) return NextResponse.json({ error: "请求来源不正确" }, { status: 403 });
  } catch { return NextResponse.json({ error: "请求来源不正确" }, { status: 403 }); }
  const form = await request.formData();
  const result = await setProjectView(projectId, String(form.get("view") ?? ""));
  if (result.error) return NextResponse.json(result, { status: 403 });
  const base = `/projects/${projectId}`;
  const raw = String(form.get("returnTo") ?? base);
  const destination = new URL(raw, "http://project-view.invalid");
  const safe = destination.origin === "http://project-view.invalid" && (destination.pathname === base || destination.pathname.startsWith(`${base}/`));
  // Relative Location preserves the browser host, even when Next sees localhost internally.
  return new NextResponse(null, { status: 303, headers: { Location: safe ? `${destination.pathname}${destination.search}` : base } });
}
