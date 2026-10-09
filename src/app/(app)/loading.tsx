export default function Loading() {
  return <section className="mx-auto w-full max-w-6xl px-5 py-10" aria-busy="true" aria-label="正在加载页面">
    <p role="status" className="mb-8 flex items-center gap-2 text-sm text-ink-3"><span className="ac-loading-dot" aria-hidden />正在打开工作区…</p>
    <div className="ac-page-skeleton h-8 w-48 rounded-lg" />
    <div className="mt-8 grid gap-5 sm:grid-cols-3">{[0, 1, 2].map(id => <div key={id} className="ac-page-skeleton h-40 rounded-xl" />)}</div>
  </section>;
}
