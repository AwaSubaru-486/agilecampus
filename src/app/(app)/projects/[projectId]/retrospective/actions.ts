"use server";

import { z } from "zod";
import { auth } from "@/lib/auth";
import { getProjectForUser } from "@/lib/project";
import { getProjectPerspective } from "@/lib/project-view";
import { buildPersonalRetrospective, buildProjectRetrospective, buildTeamMemberRetrospectives } from "@/lib/project-retrospective";
import { memberPage, teamOverview, type Notebook } from "./notebook-data";

type GenerateResult = { report: Notebook } | { error: string };

export async function generateProjectNotebook(projectId: string, requestPersonal: boolean): Promise<GenerateResult> {
  const session = await auth();
  if (!session?.user) return { error: "请重新登录后生成报告。" };
  if (!z.uuid().safeParse(projectId).success) return { error: "项目地址无效。" };
  const actorId = session.user.id;

  try {
    const access = await getProjectForUser(actorId, projectId);
    if (!access) return { error: "当前账号无法查看这个项目。" };
    const { role, viewUserId, viewUserName } = await getProjectPerspective(access.role, projectId, actorId, access.project.teamId);
    const personal = role === "student" || (role === "admin" && requestPersonal === true);
    const base = `/projects/${projectId}`;
    const metadata = {
      projectName: access.project.name,
      generatedAt: new Date().toISOString(),
      draftKey: `agilecampus.retrospective.v1:${actorId}:${viewUserId}:${projectId}:${personal ? "personal" : "team"}`,
      personal,
    };

    if (personal) {
      const report = await buildPersonalRetrospective(actorId, projectId, viewUserId);
      const page = memberPage(base, { id: viewUserId, name: viewUserName ?? session.user.name ?? "我的复盘", role, report }, "mine");
      const totalEvidence = report.deliveries.reduce((total, task) => total + task.evidenceCount, 0);
      const overview = {
        id: "overview", title: "总体评价", metrics: page.metrics,
        evaluation: report.deliveries.length
          ? `本轮有 ${report.deliveries.length} 项任务留下了交付或验收记录，共有 ${totalEvidence} 项交付材料。可以翻到个人页核对具体成果和收到的意见。`
          : "当前还没有可以回看的个人交付记录。完成一次提交后，可以在个人页结合验收意见复盘。",
        nextAction: page.nextAction,
      };
      return { report: { ...metadata, pages: [overview, page] } };
    }

    const [report, members] = await Promise.all([
      buildProjectRetrospective(actorId, projectId),
      buildTeamMemberRetrospectives(actorId, projectId),
    ]);
    const canReview = role === "admin";
    const pages = [teamOverview(projectId, report, canReview), ...members.map(member =>
      memberPage(base, member, canReview ? "all" : "completed"))];
    return { report: { ...metadata, pages } };
  } catch {
    return { error: "暂时无法生成复盘报告，请稍后重试。" };
  }
}
