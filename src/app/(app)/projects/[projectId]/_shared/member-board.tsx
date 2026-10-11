import Link from "@/components/feedback-link";
import { getTaskTree } from "@/lib/task-tree";
import { listProjectBlockers } from "@/lib/blocker";
import { groupTasksByStage } from "@/lib/project-stage-groups";
import { statusLabel } from "@/lib/task-status";

export async function MemberBoard({ actorId, projectId }: { actorId: string; projectId: string }) {
  const [tree, blockers] = await Promise.all([
    getTaskTree(actorId, projectId),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);
  const mine = tree.tasks.filter(task => !task.isTaskGroup && task.assigneeId === actorId);
  const groups = groupTasksByStage(tree.stages, mine);
  const base = `/projects/${projectId}`;
  return <section data-tour="member-board" className="space-y-6">
    <header><h2 className="text-2xl font-semibold text-ink">看板</h2><p className="mt-2 text-sm text-ink-3">按阶段查看我的任务，关注团队需要的帮助。</p></header>
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
      <section className="ac-card overflow-hidden"><header className="flex items-center justify-between border-b border-stroke p-4"><h3 className="font-semibold">我的任务</h3><Link className="text-sm text-signal" href={`${base}?space=work&scope=mine&panel=list`}>查看任务 →</Link></header>
        {groups.map(group => <details key={group.id} className="border-b border-stroke last:border-0"><summary className="cursor-pointer p-4 font-medium">{group.label}</summary><div className="px-4 pb-4"><p className="mb-2 text-xs text-ink-3">{group.title}</p>
          {group.tasks.length ? <ul className="divide-y divide-stroke">{group.tasks.map(task => <li key={task.id}><Link className="flex items-center justify-between gap-4 py-3 text-sm hover:text-signal" href={`${base}?space=work&scope=mine&task=${task.id}`}><span>{task.title}</span><span className="shrink-0 text-xs text-ink-3">{statusLabel(task.status)}</span></Link></li>)}</ul> : <p className="py-3 text-sm text-ink-3">此阶段没有分配给你的任务。</p>}
        </div></details>)}
        {!groups.length && <p className="p-6 text-sm text-ink-3">组长分配任务后，会按阶段显示在这里。</p>}
      </section>
      <aside className="ac-card overflow-hidden"><header className="border-b border-stroke p-4"><h3 className="font-semibold">协作中心</h3><p className="mt-1 text-xs text-ink-3">看看谁需要帮助，以及具体需要什么。</p></header>
        {blockers.length ? <ul className="divide-y divide-stroke">{blockers.map(item => <li key={item.id} className="p-4"><p className="font-medium text-ink">{item.raisedByName ?? "项目成员"}需要帮助</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-ink-2">{item.helpNeeded ?? item.detail ?? "请查看求助详情"}</p>{item.helpNeeded && item.detail && <p className="mt-1 text-xs text-ink-3">{item.detail}</p>}<Link className="mt-3 inline-block text-xs text-signal" href={item.taskId ? `${base}?space=work&scope=all&task=${item.taskId}` : "/collaboration"}>{item.taskTitle ?? "查看求助详情"} →</Link></li>)}</ul> : <p className="p-6 text-sm text-ink-3">当前没有未解决的求助。</p>}
      </aside>
    </div>
  </section>;
}
