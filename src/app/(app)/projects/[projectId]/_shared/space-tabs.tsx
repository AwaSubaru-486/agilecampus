import Link from "next/link";
import {
  PROJECT_SPACES,
  SPACE_HINT,
  SPACE_LABEL,
  buildSpaceHref,
  type ProjectSpace,
} from "@/lib/project-space";

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
}: {
  projectId: string;
  current: ProjectSpace;
  taskId?: string;
}) {
  return (
    <nav aria-label="项目视图" className="flex items-center gap-0.5">
      {PROJECT_SPACES.map((s) => {
        const isActive = s === current;
        return (
          <Link
            key={s}
            href={buildSpaceHref({ projectId, space: s, taskId })}
            aria-current={isActive ? "page" : undefined}
            title={SPACE_HINT[s]}
            className={`rounded-[var(--radius-control)] px-2.5 py-1 text-sm transition-colors ${
              isActive
                ? "bg-ink text-white"
                : "text-ink-2 hover:bg-sunken hover:text-ink"
            }`}
          >
            {SPACE_LABEL[s]}
          </Link>
        );
      })}
    </nav>
  );
}
