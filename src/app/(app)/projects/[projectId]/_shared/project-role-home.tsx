import Link from "next/link";
import type { TeamRole } from "@/db/schema";
import { listProjectTasks } from "@/lib/task";
import { getTaskTree } from "@/lib/task-tree";
import { listProjectBlockers } from "@/lib/blocker";
import { PROJECT_ROLE_WORKSPACE } from "@/lib/project-role-workspace";
import { statusLabel } from "@/lib/task-status";

export async function ProjectRoleHome({ actorId, projectId, role }: { actorId: string; projectId: string; role: TeamRole }) {
  const [tasks, tree, blockers] = await Promise.all([
    listProjectTasks(actorId, projectId), getTaskTree(actorId, projectId),
    listProjectBlockers(actorId, projectId, { status: ["open"] }),
  ]);
  const base = `/projects/${projectId}`;
  const current = PROJECT_ROLE_WORKSPACE[role];
  const leaves = tasks.filter(task => !task.isTaskGroup);
  const mine = leaves.filter(task => task.assigneeId === actorId && task.status !== "done");
  const review = leaves.filter(task => task.status === "review" && (role === "admin" || task.assigneeId !== actorId));
  const unassigned = leaves.filter(task => !task.assigneeId && task.status !== "done");
  const integrations = tree.integrations.filter(item => item.decision === "pending" && item.submittedById !== actorId);
  const activeStage = tree.stages.find(stage => stage.status === "active" || stage.status === "integrating");
  const focus = role === "student" ? mine : role === "teacher" ? review : unassigned;
  const title = role === "student" ? "需要我交付" : role === "teacher" ? "等待成果验收" : "需要安排负责人";
  const empty = role === "student" ? "目前没有分配给你的未完成任务。可以查看阶段安排，或等组长分配工作。"
    : role === "teacher" ? "目前没有需要你验收的成果。成员提交后会出现在这里。"
    : "当前任务均已安排负责人。继续关注成员阻塞和本轮交付。";
  const metrics = role === "student" ? [["待接住", mine.filter(task => (task.status === "todo" || task.status === "doing") && !task.committedAt).length], ["执行中", mine.filter(task => task.status === "doing").length], ["等待验收", mine.filter(task => task.status === "review").length]]
    : role === "teacher" ? [["成果待验收", review.length], ["集成待审核", integrations.length], ["成员求助", blockers.length]]
    : [["待分配", unassigned.length], ["成员阻塞", blockers.length], ["成果待验收", review.length]];
  return (
    <section data-role-workspace={role} className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-medium text-signal">{current.name}工作区</p><h2 className="mt-2 text-2xl font-semibold text-ink">{current.title}</h2><p className="mt-2 text-sm leading-6 text-ink-3">{current.description}</p></div>
        <Link className="ac-btn" href={role === "admin" ? `${base}/task-tree?plan=1#planning` : `${base}?space=work&panel=list`}>{role === "admin" ? tree.stages.length ? "规划下一轮" : "规划第一轮" : role === "teacher" ? "进入成果验收" : "进入我的任务"}</Link>
      </header>
      <dl className="grid grid-cols-3 divide-x divide-stroke border-y border-stroke py-5">
        {metrics.map(([label, value]) => <div key={label} className="px-3 first:pl-0 sm:px-6"><dt className="text-xs text-ink-3">{label}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums text-ink">{value}</dd></div>)}
      </dl>
      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          <section><header className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold text-ink">{title}</h3><Link className="text-sm text-signal" href={`${base}?space=work&panel=list${role === "admin" ? "&scope=all" : ""}`}>查看任务</Link></header>
            {focus.length ? <ul className="divide-y divide-stroke border-y border-stroke">{focus.slice(0, 8).map(task => <li key={task.id}><Link href={`${base}?space=work&task=${task.id}`} className="flex min-h-16 items-center justify-between gap-4 py-4 hover:bg-panel-hover"><span className="min-w-0"><span className="block font-medium text-ink">{task.title}</span><span className="mt-1 block text-xs text-ink-3">{task.assigneeName ?? "尚未分配"}{task.dueDate ? `，截止 ${task.dueDate}` : ""}</span></span><span className="shrink-0 text-xs text-ink-3">{statusLabel(task.status)}</span></Link></li>)}</ul> : <p className="border-y border-stroke py-8 text-sm leading-6 text-ink-3">{empty}</p>}
          </section>
          {role === "teacher" ? <section><h3 className="mb-3 font-semibold text-ink">等待阶段集成审核</h3>{integrations.length ? <ul className="divide-y divide-stroke">{integrations.map(item => <li key={item.id}><Link className="flex min-h-14 items-center justify-between gap-4 py-3 text-sm text-ink" href={`${base}/task-tree?stage=${item.stageId}#stage-${item.stageId}`}><span>{tree.stages.find(stage => stage.id === item.stageId)?.title ?? "阶段集成"}</span><span className="text-signal">检查集成材料 →</span></Link></li>)}</ul> : <p className="text-sm leading-6 text-ink-3">尚无可由你审核的集成提交。组长提交后，可在这里查看分支、测试说明并给出决定。</p>}</section>
            : role === "admin" ? <section><h3 className="mb-3 font-semibold text-ink">成员遇到的阻塞</h3>{blockers.length ? <ul className="divide-y divide-stroke">{blockers.slice(0, 5).map(item => <li key={item.id}><Link className="block py-3 text-sm text-ink" href={item.taskId ? `${base}?space=work&task=${item.taskId}` : "/collaboration"}>{item.helpNeeded ?? item.detail ?? "查看成员求助"}</Link></li>)}</ul> : <p className="text-sm text-ink-3">当前没有未解决的求助。</p>}<Link className="mt-3 inline-block text-sm text-signal" href={`${base}?space=work&panel=list`}>查看团队任务与待验收成果 →</Link></section>
            : <p className="text-sm leading-6 text-ink-3">打开任务后先确认完成标准，再认领和提交。求助入口会带上当前任务背景。</p>}
        </div>
        <aside className="space-y-5 border-l-2 border-stroke pl-5">
          <p className="text-xs text-ink-3">{role === "teacher" ? "审核背景" : "本轮安排"}</p><h3 className="font-semibold text-ink">{activeStage?.title ?? "尚未开始第一轮"}</h3><p className="text-sm leading-6 text-ink-3">{activeStage ? "任务验收与阶段集成分别确认。查看阶段详情了解交付要求及尚缺的材料。" : role === "admin" ? "先写清项目目标，生成草案并确认分工。" : "组长发布任务后，阶段安排会出现在这里。"}</p>
          <Link className="block text-sm font-medium text-signal" href={`${base}/task-tree${role === "student" ? "?scope=mine" : ""}`}>{current.iterations} →</Link><Link className="block text-sm text-ink-3" href={`${base}?space=record`}>{current.record} →</Link>
          {role === "teacher" && <Link className="block text-sm text-ink-3" href={`${base}/retrospective`}>查看成员贡献与过程记录 →</Link>}
        </aside>
      </div>
    </section>
  );
}
