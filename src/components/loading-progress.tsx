/** Indeterminate progress: the request is active, without inventing a percentage. */
export function LoadingProgress({ label = "正在加载…", detail, className = "" }: { label?: string; detail?: string; className?: string }) {
  return <div role="status" className={`ac-loading-progress ${className}`}>
    <div className="flex items-center gap-2 text-sm text-signal"><span className="ac-loading-dot" aria-hidden />{label}</div>
    {detail && <p className="mt-1 text-xs leading-5 text-ink-3">{detail}</p>}
    <div className="ac-progress-track" aria-hidden="true"><span className="ac-progress-runner" /></div>
  </div>;
}
