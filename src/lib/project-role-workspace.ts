import type { TeamRole } from "@/db/schema";

/** Presentation follows the authenticated team role; this never grants permissions. */
export const PROJECT_ROLE_WORKSPACE = {
  admin: {
    name: "组长", title: "项目推进台", description: "先安排本轮分工，再处理阻塞、验收与阶段集成。",
    work: "我的任务", iterations: "时间线", record: "成果与记录", studio: "AI 助手",
  },
  student: {
    name: "组员", title: "看板", description: "按阶段查看我的任务，关注团队需要的帮助。",
    work: "我的任务", iterations: "时间线", record: "成果与记录", studio: "AI 助手",
  },
  teacher: {
    name: "导师", title: "导师审核台", description: "对照完成标准检查成果，审核阶段集成，留下具体反馈。",
    work: "成果验收", iterations: "时间线", record: "成果与记录", studio: null,
  },
} satisfies Record<TeamRole, { name: string; title: string; description: string; work: string; iterations: string; record: string; studio: string | null }>;

export function projectTaskScope(role: TeamRole, scope: string | null): "completed" | "review" | "all" | "mine" {
  if (role === "teacher") return "completed" as const;
  if (role === "admin" && (scope === "review" || scope === "completed")) return scope;
  if (scope === "all") return "all" as const;
  return "mine" as const;
}

export function isProjectHome(params: Record<string, string | string[] | undefined>) {
  return params.space === "home" || !Object.values(params).some(Boolean);
}
