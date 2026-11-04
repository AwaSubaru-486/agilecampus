import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { listTaskNotifications } from "@/lib/task-notifications";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { and, eq, lte, ne } from "drizzle-orm";
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
  const projectRoot = getProjectRoot();
  const runtimeDir = path.resolve(projectRoot, ".runtime");
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  // 1. 读取当前桌宠配置
  const configFile = path.resolve(runtimeDir, "desk-pet-config.json");
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

  // 2. 读取并消费待触发的手动/测试事件队列
  const eventsFile = path.resolve(runtimeDir, "desk-pet-events.json");
  let events: Array<{ id: string; type: string; title?: string; text?: string }> = [];
  if (fs.existsSync(eventsFile)) {
    try {
      events = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
      // 消费后清空队列，避免重复触发
      fs.writeFileSync(eventsFile, "[]", "utf8");
    } catch {}
  }

  // 3. 读取当前登录用户的网站通知与任务预警
  let notifications: Array<{ id: string; title: string; text: string }> = [];
  let overdueTasks: Array<{ id: string; title: string; dueDate?: string | null }> = [];
  let recentCompletedTasks: Array<{ id: string; title: string }> = [];

  try {
    const session = await auth();
    if (session?.user?.id) {
      const notices = await listTaskNotifications(session.user.id);
      notifications = notices.map((n) => ({
        id: n.id,
        title: `任务交接提醒：${n.projectName}`,
        text: `「${n.sourceTitle}」已验收通过，轮到你接棒负责「${n.taskTitle}」啦！`,
      }));

      // 查询即将逾期或已逾期的未完成任务 (截止日期在今天及以前)
      const todayStr = new Date().toISOString().slice(0, 10);
      const userTasks = await db
        .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, status: tasks.status })
        .from(tasks)
        .where(
          and(
            eq(tasks.assigneeId, session.user.id),
            ne(tasks.status, "done"),
            lte(tasks.dueDate, todayStr)
          )
        )
        .limit(3);

      overdueTasks = userTasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueDate: t.dueDate,
      }));
    }
  } catch (err) {
    // 忽略未登录或未就绪状态
  }

  return NextResponse.json({
    config,
    events,
    notifications,
    overdueTasks,
    recentCompletedTasks,
  });
}
