import type { TeamRole } from "@/db/schema";
import type { ContributionRow } from "@/lib/contribution";
import { ENTRY_LABEL } from "@/lib/entry-labels";
import type { PersonalRetrospective, ProjectRetrospective } from "@/lib/project-retrospective";
import { statusLabel } from "@/lib/task-status";

type Metric = { label: string; value: number };
type Source = { title: string; href: string };
type FollowUp = { title: string; text: string; href: string };

export type NotebookDelivery = {
  id: string;
  title: string;
  status: string;
  tone: "success" | "waiting" | "attention" | "neutral";
  submission: string | null;
  feedback: string | null;
  feedbackLabel: string;
  evidenceCount: number;
  href: string;
};

export type NotebookPage = {
  id: string;
  title: string;
  role?: string;
  evaluation: string;
  metrics: Metric[];
  nextAction: string;
  deliveries?: NotebookDelivery[];
  highlights?: Source[];
  followUps?: FollowUp[];
  archive?: Source[];
};

export type Notebook = {
  projectName: string;
  generatedAt: string;
  draftKey: string;
  personal: boolean;
  pages: NotebookPage[];
};

const roleNames: Record<TeamRole, string> = { admin: "组长", student: "组员", teacher: "导师" };

export function teamOverview(projectId: string, report: ProjectRetrospective, canReview: boolean): NotebookPage {
  const base = `/projects/${projectId}`;
  const { accepted, waiting, rework, recheckFollowUp, unarchived, completedWithoutReview, archives, entries, integrations, contribution } = report;
  const qualityFollowUps = rework.length + recheckFollowUp.length;
  const openHelp = contribution.blockerStats.open;
  const followUps: FollowUp[] = [];
  if (waiting.length) followUps.push({ title: `${waiting.length} 项等待验收`, text: "按任务的完成条件核对提交和证据。", href: canReview ? `${base}?space=work&scope=review` : `${base}?space=record` });
  if (qualityFollowUps) followUps.push({ title: `${qualityFollowUps} 项需要补交或调整`, text: "对照退回或导师复核意见确认缺少的材料。", href: `${base}/activity` });
  if (openHelp) followUps.push({ title: `${openHelp} 条求助待处理`, text: "在协作中心确认负责人和需要补充的内容。", href: `/collaboration?project=${projectId}#help` });
  if (integrations.pending) followUps.push({ title: `${integrations.pending} 项阶段集成待审核`, text: "核对集成分支、测试摘要和审核记录。", href: `${base}?space=work&scope=completed` });
  if (unarchived.length || completedWithoutReview) followUps.push({ title: "补齐交付依据", text: `有 ${unarchived.length} 项验收成果待归档，${completedWithoutReview} 项完成任务待核对验收记录。`, href: `${base}?space=record#archive` });

  return {
    id: "overview",
    title: "总体评价",
    evaluation: report.hasRecords
      ? `${accepted.length ? `本轮有 ${accepted.length} 项交付通过验收，项目档案登记了 ${archives.deliverable} 项成果。` : "本轮已有提交或归档记录，验收通过的交付仍待确认。"}${followUps.length ? "下一轮应优先处理待跟进事项，再把经核对的成果补齐归档。" : "已有记录中暂未发现待审、返工、求助或归档缺口。"}`
      : "当前项目还没有足够的交付与验收记录。完成一次提交、验收和归档后，就能据此回看本轮成果。",
    metrics: [{ label: "已验收", value: accepted.length }, { label: "待验收", value: waiting.length }, { label: "归档成果", value: archives.deliverable }],
    nextAction: followUps[0]?.text ?? (report.hasRecords ? "选一项可复用的成果，把有效做法带到下一轮分工中。" : "先明确一项任务的完成条件，提交时附上可以核对的证据。"),
    highlights: accepted.slice(0, 3).map(task => ({ title: task.title, href: `${base}?space=work&scope=completed&task=${task.id}` })),
    followUps,
    archive: entries.map(entry => ({ title: `${ENTRY_LABEL[entry.type]} · ${entry.title}`, href: `${base}?space=record#entry-${entry.id}` })),
  };
}

export function memberPage(base: string, member: { id: string; name: string; role: TeamRole; report: PersonalRetrospective }, scope: "mine" | "all" | "completed", contribution?: ContributionRow): NotebookPage {
  const { assignedCount, deliveries, openHelp } = member.report;
  const passed = deliveries.filter(task => task.passed).length;
  const waiting = deliveries.filter(task => task.status === "review").length;
  const revision = deliveries.filter(task => (scope !== "completed" && task.returned) || task.needsRevision);
  const teacher = member.role === "teacher";
  const taskHref = (id: string) => `${base}?space=work&scope=${scope}&task=${id}`;
  const reviewerMetrics = teacher && !assignedCount;

  return {
    id: member.id,
    title: member.name,
    role: roleNames[member.role],
    evaluation: reviewerMetrics
      ? `本轮记录了 ${contribution?.reviewedCount ?? 0} 次验收处理。可以从项目档案查看团队的成果和反馈。`
      : assignedCount
        ? `本轮负责 ${assignedCount} 项任务，其中 ${passed} 项已有通过记录、${waiting} 项等待验收。${revision.length ? `另外有 ${revision.length} 项需要按反馈补充或调整。` : ""}`
        : "本轮暂无分给这位成员的任务。任务提交后，可以在这里回看交付说明、证据和反馈。",
    metrics: reviewerMetrics
      ? [{ label: "参与验收", value: contribution?.reviewedCount ?? 0 }, { label: "解决他人求助", value: contribution?.helpedOthersCount ?? 0 }, { label: "涉及任务", value: contribution?.touchedTaskCount ?? 0 }]
      : [{ label: "负责的任务", value: assignedCount }, { label: "验收通过", value: passed }, { label: "待验收", value: waiting }],
    nextAction: revision[0] ? `先按「${revision[0].title}」的反馈补齐材料。` : openHelp[0] && scope !== "completed" ? `先回应「${openHelp[0].title}」的求助，确认接下来需要谁协助。` : waiting ? "核对待验收任务的证据，记录需要确认的问题。" : teacher ? "在验收意见里写清采用的标准和下一步建议。" : "下次交付时把完成条件和对应证据一起记录。",
    deliveries: deliveries.filter(task => scope !== "completed" || task.passed).map(task => ({
      id: task.id,
      title: task.title,
      status: task.needsRevision ? "有复核意见" : task.returned ? "退回待补交" : task.passed ? "验收通过" : statusLabel(task.status),
      tone: task.needsRevision || task.returned ? "attention" : task.passed ? "success" : task.status === "review" ? "waiting" : "neutral",
      submission: task.submitted,
      feedback: task.feedback,
      feedbackLabel: task.needsRevision ? "导师复核意见" : task.returned ? "退回原因" : "验收意见",
      evidenceCount: task.evidenceCount,
      href: taskHref(task.id),
    })),
    followUps: scope === "completed" ? [] : openHelp.map(help => ({
      title: help.title, text: help.needed || help.detail || "查看这项任务需要的协助。", href: taskHref(help.taskId),
    })),
  };
}
