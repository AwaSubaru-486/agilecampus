import Link from "next/link";
import type { TeamRole } from "@/db/schema";

const roles = {
  admin: {
    name: "组长",
    title: "规划下一步，组织阶段交付",
    description: "生成任务草案、安排负责人；汇总已验收成果，提交阶段集成。",
    action: "规划与分配",
  },
  student: {
    name: "组员",
    title: "接下任务，交付可验收成果",
    description: "在执行台认领任务、提交成果；在任务树登记交付分支。",
    action: "查看阶段任务",
  },
  teacher: {
    name: "导师",
    title: "审核成果，把关阶段质量",
    description:
      "在执行台验收任务；在任务树审核集成，或在项目记录中留下评审意见。",
    action: "查看待审核阶段",
  },
} as const;

export function RoleWorkspace({
  role,
  projectId,
}: {
  role: TeamRole;
  projectId: string;
}) {
  const current = roles[role];
  return (
    <section
      className="flex flex-wrap items-center justify-between gap-4 border-l-2 border-signal bg-panel px-4 py-4"
      aria-label="我的项目职责"
    >
      <div className="min-w-0">
        <p className="mb-1 text-xs text-signal">当前角色：{current.name}</p>
        <h2 className="font-display text-base font-semibold text-ink">
          {current.title}
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-soft">
          {current.description}
        </p>
      </div>
      <Link
        href={`/projects/${projectId}/task-tree`}
        className="ac-btn-ghost shrink-0"
      >
        {current.action} →
      </Link>
    </section>
  );
}
