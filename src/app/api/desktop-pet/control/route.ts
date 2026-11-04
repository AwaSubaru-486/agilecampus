import { NextResponse } from "next/server";
import { webPetActor, webPetRuntime } from "@/lib/pets/web-pet-security";
import path from "path";
import fs from "fs";


export async function POST(req: Request) {
  const actor = await webPetActor(req);
  if (actor instanceof Response) return actor;
  const raw = await req.text();
  if (Buffer.byteLength(raw) > 32768) return NextResponse.json({ error: "请求过大" }, { status: 413 });
  let body;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "请求格式无效" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "请求格式无效" }, { status: 400 });
  const { action, config, event, message } = body;
  const runtimeDir = webPetRuntime(actor);
  if (!fs.existsSync(runtimeDir)) {
    fs.mkdirSync(runtimeDir, { recursive: true });
  }

  // 1. 更新网页桌宠配置（形象切换：线条小狗 / 吃豆人 / 奶龙 / 自定义立绘）
  if (action === "update-config" && config) {
    const configFile = path.resolve(runtimeDir, "desk-pet-config.json");
    let currentConfig = {};
    if (fs.existsSync(configFile)) {
      try {
        currentConfig = JSON.parse(fs.readFileSync(configFile, "utf8"));
      } catch {}
    }
    const newConfig = { ...currentConfig, ...config };
    fs.writeFileSync(configFile, JSON.stringify(newConfig, null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      config: newConfig,
      message: "桌宠外观与设置已更新",
    });
  }

  // 2. 触发网页桌宠互动事件 (任务庆祝 / 逾期预警 / 测试消息)
  if (action === "trigger-event" && event) {
    const eventsFile = path.resolve(runtimeDir, "desk-pet-events.json");
    let queue: Array<unknown> = [];
    if (fs.existsSync(eventsFile)) {
      try {
        queue = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
      } catch {}
    }
    queue.push({
      id: "event-" + Date.now(),
      timestamp: Date.now(),
      ...event,
    });
    fs.writeFileSync(eventsFile, JSON.stringify(queue.slice(-100), null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      message: "互动事件已派发至网页桌宠",
    });
  }

  // 3. 呼叫网页桌宠到屏幕中央 (防拖拽越界走失)
  if (action === "reset-pos") {
    const eventsFile = path.resolve(runtimeDir, "desk-pet-events.json");
    let queue: Array<unknown> = [];
    if (fs.existsSync(eventsFile)) {
      try {
        queue = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
      } catch {}
    }
    queue.push({
      id: "event-" + Date.now(),
      timestamp: Date.now(),
      type: "reset-pos",
    });
    fs.writeFileSync(eventsFile, JSON.stringify(queue.slice(-100), null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      message: "已向网页桌宠发送居中呼回指令",
    });
  }

  // 4. 发送自定义即时消息给网页桌宠
  if (action === "send-message" && message) {
    const eventsFile = path.resolve(runtimeDir, "desk-pet-events.json");
    let queue: Array<unknown> = [];
    if (fs.existsSync(eventsFile)) {
      try {
        queue = JSON.parse(fs.readFileSync(eventsFile, "utf8"));
      } catch {}
    }
    const newMsgEvent = {
      id: "msg-" + Date.now(),
      type: "message",
      text: typeof message === "string" ? message : message.text,
      title: typeof message === "object" && message.title ? message.title : "💬 网站新消息",
      timestamp: Date.now(),
    };
    queue.push(newMsgEvent);
    fs.writeFileSync(eventsFile, JSON.stringify(queue.slice(-100), null, 2), "utf8");

    return NextResponse.json({
      ok: true,
      message: "新消息已广播至网页桌宠",
      event: newMsgEvent,
    });
  }

  return NextResponse.json({ ok: false, message: "未知动作指令" }, { status: 400 });
}
