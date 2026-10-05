/**
 * 交付证据列表（W05）。
 *
 * 显示类型、名称、提交人/时间、来源。
 * 有真实代码链接才展示；没有 diff 不画 diff；没有测试结果不打绿勾。
 * 数据来自服务端 /api/tasks/[taskId]/evidence 的 listTaskEvidence。
 */

export type EvidenceItem = {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  url?: string | null;
  submittedAt?: string | null;
  submitterName?: string | null;
};

export function EvidenceList({
  evidence,
}: {
  evidence: EvidenceItem[];
  projectId?: string;
}) {
  if (evidence.length === 0) {
    return <p className="text-sm text-ink-3">暂无交付证据</p>;
  }

  return (
    <ul className="space-y-2">
      {evidence.map((e) => (
        <li key={e.id} className="rounded border border-stroke p-3 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-ink truncate">{e.title}</div>
              {e.description && (
                <div className="mt-0.5 text-xs text-ink-2 line-clamp-2">{e.description}</div>
              )}
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink-3">
                <span className="rounded bg-panel px-1 py-0.5 font-mono">{e.type}</span>
                {e.submitterName && <span>{e.submitterName}</span>}
                {e.submittedAt && (
                  <span>{new Date(e.submittedAt).toLocaleDateString("zh-CN")}</span>
                )}
              </div>
            </div>
            {e.url && (
              <a
                href={e.url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
              >
                查看 →
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
