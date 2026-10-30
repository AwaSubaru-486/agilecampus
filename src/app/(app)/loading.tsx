import { LoadingProgress } from "@/components/loading-progress";
import { NavigationProgress } from "@/components/navigation-progress";

export default function Loading() {
  return <section className="mx-auto w-full max-w-6xl px-5 py-10" aria-busy="true" aria-label="正在加载页面">
    <NavigationProgress active />
    <LoadingProgress className="mb-8 max-w-lg" label="正在打开工作区…" detail="正在读取项目与任务资料，请稍候。" />
    <div className="ac-page-skeleton h-8 w-48 rounded-lg" />
    <div className="mt-8 grid gap-5 sm:grid-cols-3">{[0, 1, 2].map(id => <div key={id} className="ac-page-skeleton h-40 rounded-xl" />)}</div>
  </section>;
}
