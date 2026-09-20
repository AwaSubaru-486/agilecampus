"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  parseFilters,
  serializeFilters,
  type BoardFilters,
  type GroupBy,
} from "@/lib/board-filters";

type Option = { id: string; name: string };

const GROUP_LABEL: Record<GroupBy, string> = {
  status: "状态",
  assignee: "指派人",
  priority: "优先级",
  milestone: "里程碑",
};

const PRIORITY_OPTIONS: Option[] = [
  { id: "high", name: "高" },
  { id: "medium", name: "中" },
  { id: "low", name: "低" },
];

export function FilterBar({
  members,
  milestones,
  labels,
  visible,
  total,
}: {
  members: Option[];
  milestones: Option[];
  labels: Option[];
  visible: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = parseFilters(new URLSearchParams(searchParams.toString()));

  // 筛选态写入 URL：可分享、可刷新保持、可后退。scroll:false 免得跳回页首。
  function push(next: BoardFilters) {
    const qs = serializeFilters(next);
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  function toggle(key: "assignee" | "priority" | "label" | "milestone", id: string) {
    const cur = filters[key];
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    push({ ...filters, [key]: next });
  }

  const dirty =
    filters.assignee.length > 0 ||
    filters.priority.length > 0 ||
    filters.label.length > 0 ||
    filters.milestone.length > 0 ||
    filters.overdue;
  const activeCount =
    filters.assignee.length +
    filters.priority.length +
    filters.label.length +
    filters.milestone.length +
    (filters.overdue ? 1 : 0);

  return (
    <details className="ac-toolbar group rounded-none text-sm">
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-soft">
          <span aria-hidden className="grid size-7 place-items-center border-l-2 border-signal bg-sunken text-signal">⌁</span>
          筛选与视图
          {activeCount > 0 && <span className="ac-badge bg-primary text-white">{activeCount}</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-ink-faint">{visible} / {total} 项</span>
          <select
            value={filters.group}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            onChange={(e) => push({ ...filters, group: e.target.value as GroupBy })}
            className="ac-field w-auto py-1 text-xs"
            aria-label="分组依据"
          >
            {(Object.keys(GROUP_LABEL) as GroupBy[]).map((g) => (
              <option key={g} value={g}>按{GROUP_LABEL[g]}分组</option>
            ))}
          </select>
          <span aria-hidden className="ac-icon-chevron text-ink-faint transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="flex flex-wrap items-center gap-3 border-t border-line px-3 py-3">
        <Group name="指派人">
          {[...members, { id: "none", name: "未指派" }].map((m) => (
            <Chip
              key={m.id}
              on={filters.assignee.includes(m.id)}
              onClick={() => toggle("assignee", m.id)}
            >
              {m.name}
            </Chip>
          ))}
        </Group>

        <Group name="优先级">
          {PRIORITY_OPTIONS.map((p) => (
            <Chip
              key={p.id}
              on={filters.priority.includes(p.id)}
              onClick={() => toggle("priority", p.id)}
            >
              {p.name}
            </Chip>
          ))}
        </Group>

        {labels.length > 0 && (
          <Group name="标签">
            {labels.map((l) => (
              <Chip
                key={l.id}
                on={filters.label.includes(l.id)}
                onClick={() => toggle("label", l.id)}
              >
                {l.name}
              </Chip>
            ))}
          </Group>
        )}

        {milestones.length > 0 && (
          <Group name="里程碑">
            {[...milestones, { id: "none", name: "无里程碑" }].map((m) => (
              <Chip
                key={m.id}
                on={filters.milestone.includes(m.id)}
                onClick={() => toggle("milestone", m.id)}
              >
                {m.name}
              </Chip>
            ))}
          </Group>
        )}

        <Chip on={filters.overdue} onClick={() => push({ ...filters, overdue: !filters.overdue })}>
          仅看逾期
        </Chip>
        {dirty && (
          <button
            type="button"
            onClick={() =>
              push({
                ...filters,
                assignee: [],
                priority: [],
                label: [],
                milestone: [],
                overdue: false,
              })
            }
            className="text-xs text-ink-faint underline hover:text-primary"
          >
            清空筛选
          </button>
        )}
      </div>
    </details>
  );
}

function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-xs font-medium text-ink-soft">{name}</span>
      {children}
    </span>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`ac-badge transition ${
        on ? "bg-primary text-white" : "bg-surface text-ink-soft hover:bg-primary-soft"
      }`}
    >
      {children}
    </button>
  );
}
