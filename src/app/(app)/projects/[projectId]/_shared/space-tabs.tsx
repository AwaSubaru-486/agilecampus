import Link from "next/link";
import {
  PROJECT_SPACES,
  SPACE_HINT,
  SPACE_LABEL,
  buildSpaceHref,
  type ProjectSpace,
} from "@/lib/project-space";

const WORK_STATE_KEYS = ["assignee", "priority", "label", "milestone", "overdue", "group"] as const;

// 四模式切换。
//
// 做成链接而不是按钮：模式是 URL 状态（`?space=`），
// 该能复制、该能刷新、该能前进后退。按钮会诱使人用 useState，
// 那三样就全没了。
//
// 服务端组件——它不持有任何状态，纯粹是四个 <a>。
export function SpaceTabs({
  projectId,
  current,
  /** 带着它切换模式：任务抽屉是全局叠加层，换模式不该把它甩掉 */
  taskId,
  searchParams = {},
}: {
  projectId: string;
  current: ProjectSpace;
  taskId?: string;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  return (
    <nav aria-label="项目模式" className="flex items-center gap-0.5">
      {PROJECT_SPACES.map((s) => {
        const isActive = s === current;
        const extra: Record<string, string | undefined> = {};
        if (s === "studio") {
          extra.conversation = typeof searchParams.conversation === "string" ? searchParams.conversation : undefined;
          extra.approval = typeof searchParams.approval === "string" ? searchParams.approval : undefined;
        }
        if (s === "work") {
          for (const key of WORK_STATE_KEYS) {
            extra[key] = typeof searchParams[key] === "string" ? searchParams[key] : undefined;
          }
        }
        return (
          <Link
            key={s}
            href={buildSpaceHref({ projectId, space: s, taskId, extra })}
            aria-current={isActive ? "page" : undefined}
            title={SPACE_HINT[s]}
            className={`ac-pressable min-h-10 shrink-0 border-b-2 px-2.5 py-2 text-sm transition-colors rounded-t-[var(--radius-control)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal focus-visible:ring-offset-1 ${
              isActive
                ? "border-ink font-semibold text-ink"
                : "border-transparent text-ink-2 hover:border-stroke-strong hover:text-ink"
            }`}
          >
            {SPACE_LABEL[s]}
          </Link>
        );
      })}
    </nav>
  );
}
