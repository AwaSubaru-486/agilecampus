import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

function getProjectRoot(): string {
  const cwd = process.cwd();
  if (cwd.includes(".next")) {
    return path.resolve(cwd.split(".next")[0]);
  }
  return cwd;
}

export async function GET() {
  const root = getProjectRoot();

  // 读取当前配置
  const configFile = path.resolve(root, ".runtime", "desk-pet-config.json");
  let config = {
    preset: "puppy", // "puppy" | "pacman" | "nailong" | "custom"
    name: "线条小狗",
    customImageUrl: "",
    soundEnabled: true,
  };
  if (fs.existsSync(configFile)) {
    try {
      config = { ...config, ...JSON.parse(fs.readFileSync(configFile, "utf8")) };
    } catch {}
  }

  // 读取最近的桌宠回复记录
  const repliesFile = path.resolve(root, ".runtime", "desk-pet-replies.json");
  let replies: Array<{ id: string; text: string; time: string }> = [];
  if (fs.existsSync(repliesFile)) {
    try {
      replies = JSON.parse(fs.readFileSync(repliesFile, "utf8"));
    } catch {}
  }

  return NextResponse.json({
    config,
    recentReplies: replies.slice(-10).reverse(),
  });
}
