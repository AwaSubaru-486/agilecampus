import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ENTRY_LABEL } from "@/lib/entry-labels";
import type { PersonalRetrospective, ProjectRetrospective } from "@/lib/project-retrospective";
import { statusLabel } from "@/lib/task-status";
import { DeliveryReview, type ReflectionDelivery } from "./delivery-review";
import { ReflectionNotes } from "./reflection-notes";
import styles from "./retrospective.module.css";

type FollowUp = { id?: string; title: string; detail: string; href?: string; label?: string };
type WorkspaceProps = { projectId: string; projectName: string; draftKey: string; showScopeSwitch: boolean };

export function PersonalRetrospectiveReport({ report, ...workspace }: WorkspaceProps & { report: PersonalRetrospective }) {
  const tasksHref = `/projects/${workspace.projectId}?space=work&scope=mine&panel=list`;
  const taskHref = (id: string) => `${tasksHref}&task=${id}`;
  const deliveryIds = new Set(report.deliveries.map(task => task.id));
  const helpByTask = new Map<string, NonNullable<ReflectionDelivery["openHelp"]>>();
  const followUps: FollowUp[] = [];
  for (const help of report.openHelp) {
    const detail = help.needed || help.detail || "回看已发出的求助，补充必要的背景或材料。";
    if (deliveryIds.has(help.taskId)) {
      const items = helpByTask.get(help.taskId) ?? [];
      items.push({ id: help.id, detail });
      helpByTask.set(help.taskId, items);
    } else {
      followUps.push({ id: help.id, title: `「${help.title}」的求助待处理`, detail, href: taskHref(help.taskId), label: "回到任务" });
    }
  }
  const deliveries: ReflectionDelivery[] = report.deliveries.map(task => ({
    id: task.id, title: task.title, date: task.at.toISOString(),
    status: task.needsRevision ? "有复核意见" : task.returned ? "退回待补交" : task.passed ? "验收通过" : statusLabel(task.status),
    tone: task.returned || task.needsRevision ? "attention" : task.passed ? "success" : task.status === "review" ? "waiting" : "neutral",
    submission: task.submitted, feedback: task.feedback, evidenceCount: task.evidenceCount,
    feedbackLabel: task.needsRevision ? "导师复核意见" : task.returned ? "退回原因" : undefined,
    openHelp: helpByTask.get(task.id), href: taskHref(task.id),
  }));
  const waiting = report.deliveries.filter(task => task.status === "review");

  return <ReflectionWorkspace {...workspace} scope="personal" deliveries={deliveries} followUps={followUps} tasksHref={tasksHref} metrics={[
    { label: "我的任务", value: report.assignedCount }, { label: "验收通过", value: report.deliveries.filter(task => task.passed).length }, { label: "待验收", value: waiting.length },
  ]} />;
}

export function RetrospectiveReport({ report, canReview, processDetails, ...workspace }: WorkspaceProps & {
  report: ProjectRetrospective;
  canReview: boolean;
  processDetails?: ReactNode;
}) {
  const base = `/projects/${workspace.projectId}`;
  const archive = `${base}?space=record`;
  const completed = `${base}?space=work&scope=completed&panel=list`;
  const review = `${base}?space=work&scope=review&panel=list`;
  const allWork = `${base}?space=work&scope=all&panel=list`;
  const { accepted, waiting, rework, rejected, recheckFollowUp, archives, entries, integrations, unarchived, completedWithoutReview } = report;
  const rechecks = new Map(recheckFollowUp.map(task => [task.id, task.note]));
  const deliveries: ReflectionDelivery[] = accepted.map(task => ({
    id: task.id, title: task.title, date: task.acceptedAt.toISOString(), status: rechecks.has(task.id) ? "有复核意见" : "验收通过",
    tone: rechecks.has(task.id) ? "attention" : "success", submission: task.completionNote,
    feedback: task.reviewNote, recheck: rechecks.get(task.id), href: `${completed}&task=${task.id}`,
  }));
  if (canReview) {
    deliveries.push(...rework.map((task): ReflectionDelivery => ({ id: task.id, title: task.title, date: null, status: "退回待补交",
      tone: "attention", submission: null, feedback: task.note, feedbackLabel: "退回原因", href: `${allWork}&task=${task.id}` })));
    deliveries.push(...waiting.map((task): ReflectionDelivery => ({ id: task.id, title: task.title, date: task.submittedAt?.toISOString() ?? null,
      status: "待验收", tone: "waiting", submission: task.completionNote, feedback: null, href: `${review}&task=${task.id}` })));
  }

  const followUps: FollowUp[] = [];
  if (!canReview && waiting.length) followUps.push({ title: `${waiting.length} 项交付待验收`,
    detail: "待组长核对交付材料并给出初审结论。" });
  if (!canReview && rework[0]) followUps.push({ title: `${rework.length} 项退回待补交`,
    detail: rework[0].note ? `「${rework[0].title}」需要补交的内容：${rework[0].note}` : `和负责人核对「${rework[0].title}」的验收意见。`,
    href: `${base}/activity`, label: "查看返工依据" });
  if (integrations.pending) followUps.push({ title: `${integrations.pending} 笔阶段集成待审`, detail: "核对阶段提交的测试摘要和集成材料。", href: completed, label: "查看阶段集成审核" });
  if (unarchived[0]) followUps.push({ title: `${unarchived.length} 项已验收交付待补档`,
    detail: `可以先给「${unarchived[0].title}」关联成果或文档，方便下轮复用。`, href: `${archive}#archive`, label: "打开项目档案" });
  if (completedWithoutReview) followUps.push({ title: `${completedWithoutReview} 项完成状态待核对`,
    detail: "这些任务可以补齐对应的验收结论和交付依据。", href: completed, label: "查看已完成任务" });

  return <ReflectionWorkspace {...workspace} scope="team" deliveries={deliveries} followUps={followUps} tasksHref={canReview ? allWork : completed} metrics={[
    { label: "已验收", value: accepted.length }, { label: "待验收", value: waiting.length }, { label: "归档成果", value: archives.deliverable },
  ]}>
    {(rejected.length > 0 || entries.length > 0 || processDetails) && <details className={styles.disclosure}>
      <summary>更多项目记录</summary>
      <div className={styles.disclosureBody}>
        {rejected.length > 0 && <section className={styles.sources}>
          <h3>近期退回记录</h3>
          <ul>{rejected.map(item => <li key={item.id}><strong className="text-sm text-ink">{item.title}</strong>{item.note && <p className={styles.sourceDetail}>{item.note}</p>}</li>)}</ul>
          <Link href={`${base}/activity`} className={styles.sourceLink}>查看活动记录 →</Link>
        </section>}
        {entries.length > 0 && <section className={styles.sources}>
          <h3>归档成果与反馈</h3>
          <p className={styles.muted}>{archives.deliverable} 项成果、{archives.doc} 份文档、{archives.feedback} 条反馈</p>
          <ul>{entries.map(entry => <li key={entry.id}>
            <span className="mr-2 text-xs text-ink-3">{ENTRY_LABEL[entry.type]}</span>
            <Link className={styles.sourceLink} href={`${archive}#entry-${entry.id}`}>{entry.title}</Link>
            {entry.content && <p className={`${styles.sourceDetail} line-clamp-2`}>{entry.content}</p>}
          </li>)}</ul>
          <Link className={styles.sourceLink} href={`${archive}#archive`}>查看完整项目档案 →</Link>
        </section>}
        {processDetails}
      </div>
    </details>}
  </ReflectionWorkspace>;
}

function ReflectionWorkspace({ projectId, projectName, draftKey, showScopeSwitch, scope, deliveries, followUps, tasksHref, metrics, children }: WorkspaceProps & {
  scope: "personal" | "team";
  deliveries: ReflectionDelivery[];
  followUps: FollowUp[];
  tasksHref: string;
  metrics: { label: string; value: number }[];
  children?: ReactNode;
}) {
  const personal = scope === "personal";
  const reportHref = `/projects/${projectId}/retrospective`;
  return <div className={styles.workspace}>
    <header className={styles.hero}>
      <div className={styles.heroNav}>
        <Link href="/library" className={styles.backLink}><span aria-hidden>↖</span> 全部项目复盘</Link>
        {showScopeSwitch && <nav className={styles.scope} aria-label="复盘范围">
          <Link href={reportHref} aria-current={personal ? undefined : "page"}>团队复盘</Link>
          <Link href={`${reportHref}?scope=mine`} aria-current={personal ? "page" : undefined}>我的任务复盘</Link>
        </nav>}
      </div>
      <div className={styles.heroBody}>
        <div className={styles.heroTitle}>
          <h2>{personal ? "我的任务复盘" : "团队复盘"}</h2>
          <p>选一项交付，对照反馈，写下一件下次可以先做的事。</p>
        </div>
        <div className={styles.heroArtwork} aria-hidden="true">
          <Image src="/retrospective-cover.webp" alt="" fill loading="eager" fetchPriority="high"
            sizes="(max-width: 660px) 100vw, (max-width: 1120px) 40vw, 490px" />
        </div>
      </div>
      <dl className={styles.metrics}>{metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}</dl>
    </header>

    <nav className={styles.steps} aria-label="复盘步骤">
      <a href="#reflection-delivery">回看交付与反馈 <span aria-hidden>↘</span></a>
      <a href="#reflection-notes">写下下一步 <span aria-hidden>↘</span></a>
    </nav>

    <DeliveryReview key={draftKey} items={deliveries} emptyHref={tasksHref} scope={scope}>
      {followUps.length > 0 && <details className={styles.disclosure}>
        <summary>其他待跟进事项</summary>
        <ul className={`${styles.disclosureBody} ${styles.followUps}`}>{followUps.map(item => <li key={item.id ?? item.title}>
          <h4>{item.title}</h4><p>{item.detail}</p>{item.href && <Link className={styles.sourceLink} href={item.href}>{item.label} →</Link>}
        </li>)}</ul>
      </details>}
    </DeliveryReview>
    <ReflectionNotes key={draftKey} draftKey={draftKey} projectName={projectName} scope={scope} />
    {children}
  </div>;
}
