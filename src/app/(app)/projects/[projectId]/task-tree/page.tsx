import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { getProjectForUser } from "@/lib/project";
import { getTaskTree } from "@/lib/task-tree";
import { listTeamMembers } from "@/lib/team";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/task-status";
import {
  BriefForm,
  DeliveryForm,
  IntegrationReviewForm,
  IntegrationSubmitForm,
} from "./task-tree-forms";
import { DraftEditor } from "./draft-editor";

const stageLabels = {
  locked: "未解锁",
  active: "执行中",
  integrating: "待集成审核",
  completed: "已完成",
} as const;
const stageHints = {
  locked: "上一阶段集成审核通过后开放。",
  active: "完成任务验收和分支登记后，由组长提交集成。",
  integrating: "由非提交者审核集成成果。",
  completed: "阶段已通过，交付与审核记录保留在此。",
} as const;

export default async function TaskTreePage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!z.uuid().safeParse(projectId).success) notFound();
  const access = await getProjectForUser(session.user.id, projectId);
  if (!access) notFound();
  const [tree, members] = await Promise.all([
    getTaskTree(session.user.id, projectId),
    listTeamMembers(access.project.teamId),
  ]);
  const canManage = access.role === "admin";
  const canReview = canManage || access.role === "teacher";
  const actorId = session.user.id;
  const mine = query.scope === "mine";
  const leaves = tree.tasks.filter((task) => task.stageId && !task.isTaskGroup);
  const complete = leaves.filter((task) => task.status === "done").length;
  const current = tree.stages.find(
    (stage) => stage.status === "active" || stage.status === "integrating",
  );
  const latestDeliveries = new Map<string, (typeof tree.deliveries)[number]>();
  for (const delivery of tree.deliveries)
    if (!latestDeliveries.has(delivery.taskId))
      latestDeliveries.set(delivery.taskId, delivery);
  const roleName = canManage
    ? "组长"
    : access.role === "teacher"
      ? "导师"
      : "组员";
  const nextAction = canManage
    ? "补充需求、确认分工，再组织阶段集成。"
    : access.role === "teacher"
      ? "检查成果与集成材料，审核通过或填写退回原因。"
      : "查看分配给你的任务，在执行台认领与提交成果。";

  return (
    <div className="space-y-6">
      <header className="border-b border-stroke pb-5">
        <Link
          href={`/projects/${projectId}?space=work`}
          className="text-xs text-ink-soft hover:text-signal"
        >
          ← {access.project.name}
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-signal">{roleName}工作区</p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-ink">
              任务与阶段迭代
            </h1>
            <p className="mt-2 text-sm text-ink-soft">{nextAction}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/projects/${projectId}?space=work`}
              className="ac-btn-ghost"
            >
              执行与验收
            </Link>
            {canManage && (
              <a href="#planning" className="ac-btn">
                ＋ 生成任务草案
              </a>
            )}
          </div>
        </div>
      </header>
      <section
        aria-label="项目阶段进度"
        className="grid gap-px overflow-hidden border border-stroke bg-stroke sm:grid-cols-3"
      >
        <div className="bg-panel p-4">
          <p className="text-xs text-ink-faint">当前阶段</p>
          <p className="mt-2 font-semibold text-ink">
            {current?.title ??
              (tree.stages.length ? "全部阶段已完成" : "等待规划")}
          </p>
          <p className="mt-1 text-xs text-ink-soft">
            {current ? stageLabels[current.status] : "从项目说明开始"}
          </p>
        </div>
        <div className="bg-panel p-4">
          <p className="text-xs text-ink-faint">任务验收进度</p>
          <p className="mt-2 text-xl tabular-nums text-ink">
            {complete}
            <span className="text-sm text-ink-faint"> / {leaves.length}</span>
          </p>
          <progress
            aria-label="已验收任务比例"
            className="mt-2 h-1.5 w-full accent-[var(--color-signal)]"
            value={complete}
            max={leaves.length || 1}
          />
        </div>
        <div className="bg-panel p-4">
          <p className="text-xs text-ink-faint">待处理</p>
          <p className="mt-2 text-sm text-ink">
            {canManage
              ? `${tree.drafts.length} 份任务草案`
              : access.role === "teacher"
                ? `${tree.stages.filter((stage) => stage.status === "integrating").length} 个阶段待审核`
                : `${leaves.filter((task) => task.assigneeId === actorId && task.status !== "done").length} 项我的未完成任务`}
          </p>
          <p className="mt-2 text-xs text-ink-soft">
            {tree.stages.filter((stage) => stage.status === "completed").length}{" "}
            / {tree.stages.length} 个阶段已完成
          </p>
        </div>
      </section>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-5">
          {!!tree.stages.length && (
            <nav
              aria-label="阶段导航"
              className="flex gap-2 overflow-x-auto pb-2"
            >
              {tree.stages.map((stage, index) => (
                <a
                  key={stage.id}
                  href={`#stage-${stage.id}`}
                  className="shrink-0 border border-stroke px-3 py-2 text-xs text-ink-soft"
                >
                  {index + 1}. {stage.title} · {stageLabels[stage.status]}
                </a>
              ))}
            </nav>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display font-semibold text-ink">阶段任务</h2>
            {access.role === "student" && (
              <nav aria-label="任务范围" className="flex gap-3 text-xs">
                <Link
                  aria-current={!mine ? "page" : undefined}
                  className={!mine ? "text-signal" : "text-ink-soft"}
                  href={`/projects/${projectId}/task-tree`}
                >
                  全部任务
                </Link>
                <Link
                  aria-current={mine ? "page" : undefined}
                  className={mine ? "text-signal" : "text-ink-soft"}
                  href={`/projects/${projectId}/task-tree?scope=mine`}
                >
                  我的任务
                </Link>
              </nav>
            )}
          </div>
          {!tree.stages.length && (
            <section className="border border-dashed border-stroke px-6 py-12 text-center">
              <h3 className="font-semibold text-ink">还没有阶段任务</h3>
              <p className="mt-2 text-sm text-ink-soft">
                {canManage
                  ? "提交项目说明，生成草案并确认后，团队就可以开始执行。"
                  : "组长发布任务草案后，阶段与负责人会显示在这里。"}
              </p>
              {canManage && (
                <a
                  href="#planning"
                  className="mt-4 inline-flex text-sm text-signal"
                >
                  开始规划 →
                </a>
              )}
            </section>
          )}
          {tree.stages.map((stage, index) => {
            const tasks = tree.tasks.filter(
              (task) => task.stageId === stage.id,
            );
            const stageLeaves = tasks.filter((task) => !task.isTaskGroup);
            const rows = mine
              ? stageLeaves.filter((task) => task.assigneeId === actorId)
              : stageLeaves;
            const integration = tree.integrations.find(
              (item) => item.stageId === stage.id,
            );
            const ready =
              stageLeaves.length > 0 &&
              stageLeaves.every(
                (task) =>
                  task.status === "done" && latestDeliveries.has(task.id),
              );
            return (
              <section
                id={`stage-${stage.id}`}
                key={stage.id}
                className="scroll-mt-20 border border-stroke bg-panel"
              >
                <header className="border-b border-stroke p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold text-ink">
                      <span className="mr-3 text-xs tabular-nums text-ink-faint">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      {stage.title}
                    </h3>
                    <span
                      className={`text-xs ${stage.status === "completed" ? "text-done" : stage.status === "active" ? "text-signal" : "text-ink-soft"}`}
                    >
                      {stageLabels[stage.status]}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-soft">
                    {stageHints[stage.status]}
                  </p>
                </header>
                <div className="divide-y divide-stroke">
                  {!rows.length && (
                    <p className="p-4 text-sm text-ink-faint">
                      此阶段没有分配给你的执行任务。
                    </p>
                  )}
                  {rows.map((task) => {
                    const delivery = latestDeliveries.get(task.id);
                    const parent = tasks.find(
                      (item) => item.id === task.parentTaskId,
                    );
                    const mayDeliver =
                      access.role !== "teacher" &&
                      (canManage || task.assigneeId === actorId);
                    return (
                      <article key={task.id} className="p-4">
                        {parent && (
                          <p className="mb-1 text-xs text-ink-faint">
                            {parent.title}
                          </p>
                        )}
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <Link
                            href={`/projects/${projectId}?space=work&task=${task.id}`}
                            className="text-sm font-semibold text-ink hover:text-signal"
                          >
                            {task.title} ↗
                          </Link>
                          <span
                            className={`text-xs ${STATUS_TONE[task.status]}`}
                          >
                            {STATUS_LABEL[task.status]}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-ink-soft">
                          {task.assigneeName ?? "待分配"}
                          {task.assigneeId === actorId
                            ? " · 我的任务"
                            : ""} ·{" "}
                          {
                            { low: "低", medium: "中", high: "高" }[
                              task.priority
                            ]
                          }
                          优先级
                        </p>
                        {task.description && (
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-soft">
                            {task.description}
                          </p>
                        )}
                        {Array.isArray(task.doneCriteria) && (
                          <ul className="mt-2 space-y-1 text-xs leading-5 text-ink-faint">
                            {(task.doneCriteria as string[]).map(
                              (criterion, i) => (
                                <li key={i}>□ {criterion}</li>
                              ),
                            )}
                          </ul>
                        )}
                        {delivery && (
                          <div className="mt-3 border-l-2 border-stroke pl-3 text-xs text-ink-soft">
                            <p className="break-all">
                              交付分支：{delivery.branchName}
                              {delivery.headSha
                                ? ` · ${delivery.headSha.slice(0, 10)}`
                                : ""}
                            </p>
                            {delivery.testSummary && (
                              <p className="mt-1">
                                测试摘要：{delivery.testSummary}
                              </p>
                            )}
                            {delivery.pullRequestUrl &&
                              /^https?:\/\//i.test(delivery.pullRequestUrl) && (
                                <a
                                  href={delivery.pullRequestUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-1 inline-block text-signal"
                                >
                                  查看 Pull Request ↗
                                </a>
                              )}
                          </div>
                        )}
                        {stage.status === "active" && mayDeliver && (
                          <details className="mt-3">
                            <summary className="cursor-pointer text-xs text-signal">
                              {delivery ? "更新交付分支" : "登记交付分支"}
                            </summary>
                            <DeliveryForm
                              projectId={projectId}
                              taskId={task.id}
                            />
                          </details>
                        )}
                      </article>
                    );
                  })}
                </div>
                {stage.status === "active" && canManage && (
                  <footer className="border-t border-stroke p-4">
                    {ready ? (
                      <IntegrationSubmitForm
                        projectId={projectId}
                        stageId={stage.id}
                      />
                    ) : (
                      <p className="text-xs text-ink-soft">
                        集成前还需完成{" "}
                        {
                          stageLeaves.filter((task) => task.status !== "done")
                            .length
                        }{" "}
                        项任务验收、登记{" "}
                        {
                          stageLeaves.filter(
                            (task) => !latestDeliveries.has(task.id),
                          ).length
                        }{" "}
                        项交付分支。
                      </p>
                    )}
                  </footer>
                )}
                {integration && (
                  <div className="border-t border-stroke p-4 text-xs text-ink-soft">
                    <p className="break-all">
                      集成分支：{integration.branchName}
                      {integration.headSha
                        ? ` · ${integration.headSha.slice(0, 10)}`
                        : ""}
                    </p>
                    {integration.testSummary && (
                      <p className="mt-2 whitespace-pre-wrap">
                        测试摘要：{integration.testSummary}
                      </p>
                    )}
                    {integration.reviewNote && (
                      <p className="mt-2">审核意见：{integration.reviewNote}</p>
                    )}
                    {stage.status === "integrating" &&
                      (canReview && integration.submittedById !== actorId ? (
                        <div className="mt-3">
                          <IntegrationReviewForm
                            projectId={projectId}
                            integrationId={integration.id}
                          />
                        </div>
                      ) : (
                        <p className="mt-2">
                          {integration.submittedById === actorId
                            ? "由另一位组长或导师审核你提交的集成。"
                            : "等待组长或导师审核。"}
                        </p>
                      ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <aside className="space-y-4 xl:sticky xl:top-20">
          <section className="border border-stroke bg-panel p-4">
            <h2 className="text-sm font-semibold text-ink">本轮协作</h2>
            <ol className="mt-3 space-y-4 text-xs leading-5 text-ink-soft">
              <li>
                <strong className="block text-ink">01 · 组长规划</strong>
                确认需求、任务与负责人。
              </li>
              <li>
                <strong className="block text-ink">02 · 组员交付</strong>
                认领执行、提交成果与分支。
              </li>
              <li>
                <strong className="block text-ink">03 · 人工验收</strong>
                组长或导师验收任务；阶段集成由非提交者审核。
              </li>
            </ol>
          </section>
          <section className="border border-stroke p-4 text-xs leading-5 text-ink-soft">
            <h2 className="mb-2 font-semibold text-ink">需求变化时</h2>
            组长提交补充说明，新阶段追加到现有任务之后。已完成任务和审核记录继续保留。
          </section>
          <Link
            href={`/projects/${projectId}?space=record`}
            className="block text-xs text-signal"
          >
            查看成果与评审记录 →
          </Link>
        </aside>
      </div>
      {canManage && (
        <section
          id="planning"
          className="scroll-mt-20 border border-stroke bg-panel p-5"
        >
          <div className="mb-4">
            <p className="text-xs text-signal">需求 → 草案 → 确认发布</p>
            <h2 className="mt-1 font-display text-lg font-semibold text-ink">
              生成下一轮任务
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              填写项目目标、交付要求或需求变化。生成后可以修改任务、负责人和验收标准。
            </p>
          </div>
          <BriefForm projectId={projectId} />
        </section>
      )}
      {tree.drafts.map((draft) => (
        <section
          key={draft.id}
          className="border border-signal/40 bg-panel p-5"
        >
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-semibold text-ink">
              待确认草案
            </h2>
            <span className="text-xs text-ink-soft">
              {draft.payload.stages.length} 个阶段 ·{" "}
              {draft.payload.stages.reduce(
                (count, stage) => count + stage.tasks.length,
                0,
              )}{" "}
              个任务
            </span>
          </div>
          {canManage ? (
            <DraftEditor
              projectId={projectId}
              draftId={draft.id}
              payload={draft.payload}
              members={members.filter((member) => member.role !== "teacher")}
            />
          ) : (
            <div className="space-y-3 text-sm text-ink-soft">
              <p>{draft.payload.summary}</p>
              {draft.payload.stages.map((stage, index) => (
                <div key={index}>
                  <h3 className="font-semibold text-ink">{stage.title}</h3>
                  <ul className="mt-1 space-y-1">
                    {stage.tasks.map((task) => (
                      <li key={task.key}>
                        {task.title} ·{" "}
                        {members.find((member) => member.id === task.assigneeId)
                          ?.name ?? "待分配"}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-xs">等待组长确认发布。</p>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
