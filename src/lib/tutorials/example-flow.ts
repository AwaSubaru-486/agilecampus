import type { TutorialStep, TutorialRole } from "./catalog";

export type TutorialJourney = {
  version: 4 | 5 | 6;
  teamId: string | null;
  projectId: string | null;
  taskId?: string | null;
  role?: TutorialRole;
};
export const EMPTY_JOURNEY: TutorialJourney = { version: 6, teamId: null, projectId: null };

export function welcomeStepIndex(id: string) {
  const index = buildWelcomeSteps(EMPTY_JOURNEY).findIndex(step => step.id === id);
  if (index < 0) throw new Error(`Unknown tutorial step: ${id}`);
  return index;
}

// A native task dialog closes on reload; resume at its opening action.
export function welcomeResumeIndex(index: number, journey: TutorialJourney = EMPTY_JOURNEY) {
  const steps = buildWelcomeSteps(journey);
  return ["timeline-detail", "timeline-close"].includes(steps[index]?.id)
    ? steps.findIndex(step => step.id === "timeline-node") : index;
}

export function buildWelcomeSteps(journey: TutorialJourney): TutorialStep[] {
  const team = journey.teamId ? `/teams/${journey.teamId}` : "/teams";
  const base = journey.projectId ? `/projects/${journey.projectId}` : "/projects";
  const role = journey.role ?? "admin";
  const work = `${base}?space=work${role === "admin" ? "&scope=all" : ""}`;
  const detail = `${work}${journey.taskId ? `&task=${journey.taskId}` : ""}`;
  const timeline = `${base}/timeline`;
  const step = (id: string, title: string, instruction: string, route: string, target: string, action: TutorialStep["action"] = "explore", completion?: string): TutorialStep =>
    ({ id, title, instruction, route, target: `[data-tour="${target}"]`, action, completion });

  return [
    step("directory", "从汪汪队的项目开始", "这次以汪汪队的敏捷开发平台为展示项目。按真实页面认识成员、阶段和任务分工，点击查看即可继续。", "/tutorials", "tutorial-showcase"),
    step("roles", "认识项目中的三种角色", "鱼乐、哈哈哈和聂翔是组员，负责各自任务；郭诗辉是老师，负责成果复核与集成审核；组长安排分工并推进项目。这里显示团队的当前成员档案。", `${team}/members`, "team-members"),
    ...(role === "admin" ? [
      step("leader-start", "进入组长工作区", "在查看视角中选择组长，先认识团队的真实分工；稍后再预览组员和老师界面。", base, "project-view-switch", "result", "data-tour-leader-view"),
      step("assignments", "查看组长下派的任务", "分工页列出全项目任务。每个阶段默认折叠，展开后能核对任务和负责人；组长可在任务资料与管理中调整分工。", `${work}&panel=list`, "console-task-list"),
    ] : []),
    ...(role !== "teacher" ? [
      step("board", "看板：我的任务与协作中心", "看板左侧按阶段展示我的任务，右侧显示谁需要什么帮助。没有分配给自己的任务时会显示空状态；组长可从分工查看组员的工作。", base, "member-board"),
      step("task-list", "展开阶段查看任务", "我的任务只展示分配给自己的工作。阶段默认折叠；点击具体任务会打开对应的执行详情。", `${base}?space=work&panel=list`, "console-task-list"),
      ...(journey.taskId ? [
        step("select", "打开一项实际任务", "点击高亮任务查看执行要求。这里使用已分配的项目任务，只需查看即可学习交付流程。", `${detail}&panel=list`, "console-task", "click"),
        step("delivery", "认识认领、交付与验收", "核对任务目标、负责人、完成条件和证据要求。组员确认接住后执行，提交成果进入待验收，再由有权限的人审核。查看后可直接继续。", detail, "tutorial-task-detail"),
      ] : []),
    ] : []),
    step("stages", "只看当前阶段的验收进度", "上方显示当前阶段及该阶段已验收任务的比例。阶段全部任务验收并通过集成审核后，才开放下一阶段。", timeline, "stage-progress"),
    step("timeline", "在一张任务树里看全项目", "下方是连续任务树，可以缩放、滚动并沿阶段查看任务。已完成的任务显示绿色；连线表示已经确认的前置关系。没有分析结果时先查看节点。", timeline, "timeline-tree"),
    step("stage", "定位另一个阶段", "点击阶段按钮定位任务树中的阶段。这里只调整查看位置，不会改变阶段状态。", timeline, "timeline-stages", "click"),
    step("timeline-node", "点开任务的小界面", "点击一个任务节点，在当前页面打开详情小界面。", timeline, "timeline-node", "click"),
    step("timeline-detail", "查看任务目标与完成条件", "这里显示当前负责人的任务要求、状态与已登记成果。任务未完成时成果区域可能为空。", timeline, "timeline-inspector"),
    step("timeline-close", "关闭详情回到任务树", "点击关闭，继续认识角色和协作入口。", timeline, "timeline-close", "click"),
    ...(role === "admin" ? [
      step("member-view", "预览具体组员的界面", "在组员分组中选择一位成员。看板和我的任务按这位成员展示，阶段默认折叠；成果与记录不显示。", base, "project-view-switch", "result", "data-tour-member-view"),
      step("teacher-view", "预览具体老师的界面", "在老师分组中选择一位老师。老师只复核已完成任务，并在成果验收同一页面审核阶段集成。", base, "project-view-switch", "result", "data-tour-teacher-view"),
      step("review", "成果验收与集成审核", "这里合并展示成果复核与集成审核。当前还没有已完成任务时，列表为空是正常状态；已有任务提交后先由组长验收，完成后供老师复核。", `${base}?space=work`, "execution-console"),
      step("integration", "查看阶段集成材料", "组长提交阶段集成后，老师可检查分支、测试材料和审核记录。尚未提交时会显示空状态。", `${base}?space=work`, "stage-tasks"),
      step("leader-view", "返回组长继续查看", "选择标有组长本人的选项，恢复分工、项目推进台和成果与记录入口。", base, "project-view-switch", "result", "data-tour-leader-view"),
      step("management", "项目推进台", "项目推进台帮助组长检查分工、阻塞和待验收事项，安排团队下一步工作。", `${base}?space=home&view=manage`, "project-home"),
    ] : role === "teacher" ? [
      step("review", "复核已完成任务", "成果验收只显示已完成任务。没有已完成任务时可先认识页面，等待组长验收后再复核成果与证据。", work, "execution-console"),
      step("integration", "在同一页审核阶段集成", "这里显示组长提交的阶段集成材料。审核分支、测试记录和反馈；暂无提交时会显示空状态。", work, "stage-tasks"),
    ] : []),
    ...(role !== "teacher" ? [
      step("ai", "AI 助手直接打开项目对话", "AI 助手展示项目对话与共享会话，可以围绕敏捷开发平台的需求、任务和验收标准讨论。先认识会话与上下文入口，需要讨论时再发送消息。", `${base}?space=studio&view=chat`, "ai-workspace"),
    ] : []),
    ...(role !== "student" ? [
      step("records", "查看成果与记录", "组长和老师可以查看项目成果、证据与决策。这里展示实际记录；没有登记的材料会显示空状态。", `${base}?space=record`, "project-records"),
      step("activity", "追溯任务分配与交付", "活动记录保存了任务分配、认领、提交和验收等动作，可用于查找过程和复盘。", `${base}/activity`, "activity"),
    ] : []),
    step("finish", "按功能继续学习", "主线已介绍项目中的角色、阶段与交付流程。下方目录可单独学习具体功能，默认使用同一个展示项目。", "/tutorials", "tutorial-directory"),
  ];
}
