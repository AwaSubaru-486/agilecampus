import { readWebPetConfig } from "@/lib/pets/web-pet-config";
import { NextResponse } from "next/server";
import { webPetActor, webPetRuntime } from "@/lib/pets/web-pet-security";
import path from "path";
import fs from "fs";


export async function GET() {
  const actor = await webPetActor();
  if (actor instanceof Response) return actor;
  const root = webPetRuntime(actor);

  // 读取当前配置
  const config = await readWebPetConfig(actor);

  // 读取最近的桌宠回复记录
  const repliesFile = path.resolve(root, "desk-pet-replies.json");
  let replies: Array<{ id: string; text: string; time: string }> = [];
  if (fs.existsSync(repliesFile)) {
    try {
      replies = JSON.parse(fs.readFileSync(repliesFile, "utf8"));
    } catch {}
  }

  return NextResponse.json({
    config,
    recentReplies: replies.slice(-10).reverse(),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
