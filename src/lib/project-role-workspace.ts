import type { TeamRole } from "@/db/schema";

/** Presentation follows the authenticated team role; this never grants permissions. */
export const PROJECT_ROLE_WORKSPACE = {
  admin: {
    name: "组长", title: "项目推进台", description: "先安排本轮分工，再处理阻塞、验收与阶段集成。",
    work: "分工与执行", iterations: "规划与集成", record: "交付与复盘", studio: "AI 协作",
  },
  student: {
    name: "组员", title: "我的交付台", description: "确认分配给你的工作，按完成标准交付；遇到困难及时求助。",
    work: "我的任务", iterations: "阶段与交付", record: "成果与记录", studio: "AI 助手",
  },
  teacher: {
    name: "导师", title: "导师审核台", description: "对照完成标准检查成果，审核阶段集成，留下具体反馈。",
    work: "成果验收", iterations: "集成审核", record: "评审与复盘", studio: null,
  },
} satisfies Record<TeamRole, { name: string; title: string; description: string; work: string; iterations: string; record: string; studio: string | null }>;

export function projectTaskScope(role: TeamRole, scope: string | null) {
  if (scope === "all") return "all" as const;
  return role === "student" ? "mine" as const : role === "teacher" ? "review" as const : "all" as const;
}

export function isProjectHome(params: Record<string, string | string[] | undefined>) {
  return params.space === "home" || !Object.values(params).some(Boolean);
}
