import { NextResponse } from "next/server";
import { authenticateBearer, unauthorized, mapAgentError } from "@/lib/agent-auth";
import { listAgentInbox } from "@/lib/agent-run";

// agent 领取活。
//
// 设计成「拉」而非「推」：agent 自己轮询，本机不必常驻 daemon、
// 也不必对外暴露端口。与仓库既有的 Personal API Token 同一套路子。
//
// 回三摞：
//   awaiting —— 派给我但我还没接住的（要调 claim 或 decline 回话）
//   mine     —— 我接住了、该干的
//   running  —— 我这边还没结束的 run（重启后据以恢复现场）
export async function GET(req: Request) {
  const agentUserId = await authenticateBearer(req);
  if (!agentUserId) return unauthorized();

  try {
    const inbox = await listAgentInbox(agentUserId);
    return NextResponse.json(inbox);
  } catch (e) {
    return mapAgentError(e, "[/api/agent/inbox]");
  }
}
