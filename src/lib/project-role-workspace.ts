import type { TeamRole } from "@/db/schema";

/** Presentation follows the authenticated team role; this never grants permissions. */
export const PROJECT_ROLE_WORKSPACE = {
  admin: {
    title: "项目推进台",
    work: "我的任务", iterations: "时间线", record: "成果与记录", studio: "AI 助手",
  },
  student: {
    title: "看板",
    work: "我的任务", iterations: "时间线", record: "成果与记录", studio: "AI 助手",
  },
  teacher: {
    title: "导师审核台",
    work: "成果验收", iterations: "时间线", record: "成果与记录", studio: null,
  },
} satisfies Record<TeamRole, { title: string; work: string; iterations: string; record: string; studio: string | null }>;

export function projectTaskScope(role: TeamRole, scope: string | null): "completed" | "review" | "all" | "mine" {
  if (role === "teacher") return "completed" as const;
  if (role === "admin" && (scope === "review" || scope === "completed")) return scope;
  if (scope === "all") return "all" as const;
  return "mine" as const;
}

export function isProjectHome(params: Record<string, string | string[] | undefined>) {
  return params.space === "home" || !Object.values(params).some(Boolean);
}
