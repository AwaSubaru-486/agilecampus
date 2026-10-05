import type { FilterableTask, GroupBy } from "./board-filters";
import { STATUS_LABEL, STATUS_TONE, TASK_STATUSES } from "./task-status";
import type { TaskStatus } from "@/db/schema";

// 拖拽落列时提交的字段补丁。四字段与 moveTaskAction 的白名单严格对应。
export type ColumnPatch = {
  status?: TaskStatus;
  assigneeId?: string | null;
  priority?: "low" | "medium" | "high";
  milestoneId?: string | null;
};

export type BoardColumn = {
  key: string;
  label: string;
  tone: string; // tailwind 文字色 class
  patch: ColumnPatch;
  matches: (t: FilterableTask) => boolean;
};

export type ColumnContext = {
  members: { id: string; name: string }[];
  milestones: { id: string; name: string }[];
};

const NEUTRAL = "text-ink-soft";

export function deriveColumns(group: GroupBy, ctx: ColumnContext): BoardColumn[] {
  switch (group) {
    case "assignee":
      return [
        ...ctx.members.map((m) => ({
          key: m.id,
          label: m.name,
          tone: NEUTRAL,
          patch: { assigneeId: m.id } as ColumnPatch,
          matches: (t: FilterableTask) => t.assigneeId === m.id,
        })),
        {
          key: "none",
          label: "未指派",
          tone: "text-ink-faint",
          patch: { assigneeId: null },
          matches: (t: FilterableTask) => t.assigneeId === null,
        },
      ];

    case "priority":
      return (
        [
          { key: "high", label: "高", tone: "text-high" },
          { key: "medium", label: "中", tone: "text-medium" },
          { key: "low", label: "低", tone: "text-low" },
        ] as const
      ).map((c) => ({
        key: c.key,
        label: c.label,
        tone: c.tone,
        patch: { priority: c.key } as ColumnPatch,
        matches: (t: FilterableTask) => t.priority === c.key,
      }));

    case "milestone":
      return [
        ...ctx.milestones.map((m) => ({
          key: m.id,
          label: m.name,
          tone: NEUTRAL,
          patch: { milestoneId: m.id } as ColumnPatch,
          matches: (t: FilterableTask) => t.milestoneId === m.id,
        })),
        {
          key: "none",
          label: "无里程碑",
          tone: "text-ink-faint",
          patch: { milestoneId: null },
          matches: (t: FilterableTask) => t.milestoneId === null,
        },
      ];

    case "status":
    default:
      // 列随枚举走：加了状态档，看板自动多一列，无需回来补三行字面量
      return TASK_STATUSES.map((s) => ({
        key: s,
        label: STATUS_LABEL[s],
        tone: STATUS_TONE[s],
        patch: { status: s },
        matches: (t: FilterableTask) => t.status === s,
      }));
  }
}

// 标签色板：色板键 → tailwind class。存键不存 hex，配色可控且杜绝样式注入。
export const LABEL_COLORS = [
  "slate",
  "red",
  "amber",
  "green",
  "blue",
  "violet",
  "pink",
] as const;

export const LABEL_COLOR_CLASS: Record<string, string> = {
  slate: "bg-sunken text-ink-soft",
  red: "bg-high-soft text-high",
  amber: "bg-medium-soft text-medium",
  green: "bg-low-soft text-low",
  blue: "bg-primary-soft text-primary",
  violet: "bg-primary-soft text-primary",
  pink: "bg-high-soft text-high",
};
