import type { TutorialStep, TutorialRole } from "./catalog";

export const WELCOME_VERSION = 7;
export const WELCOME_CHAPTERS = [
  { title: "现场与分工", description: "认识办公室里的成员和各自负责的任务。" },
  { title: "进度与求助", description: "顺着时间线看依赖，到协作中心查看一条求助。" },
  { title: "交付与验收", description: "查看任务要求、交付材料和对应的审核队列。" },
  { title: "迭代与复盘", description: "对照版本成果，从验收记录里找出下一步。" },
] as const;

export type TutorialJourney = {
  version: 4 | 5 | 6 | typeof WELCOME_VERSION;
  teamId: string | null;
  projectId: string | null;
  taskId?: string | null;
  helpTaskId?: string | null;
  acceptance?: { taskId: string; queue: "review" | "completed" } | null;
  role?: TutorialRole;
};
export const EMPTY_JOURNEY: TutorialJourney = { version: WELCOME_VERSION, teamId: null, projectId: null };

export function buildWelcomeSteps(journey: TutorialJourney): TutorialStep[] {
  const { teamId, projectId, taskId, helpTaskId, acceptance, role = "admin" } = journey;
  const base = projectId ? `/projects/${projectId}` : "/projects";
  const work = `${base}?space=work&scope=${role === "admin" ? "all" : "mine"}`;
  const help = projectId ? `/collaboration?project=${projectId}${helpTaskId ? `&task=${helpTaskId}#task-${helpTaskId}` : "#help"}` : "/collaboration";
  const review = `${base}?space=work&scope=${acceptance?.queue ?? "review"}${acceptance ? `&task=${acceptance.taskId}` : "&panel=list"}`;
  const step = (chapter: number, id: string, title: string, instruction: string, route: string, target: string): TutorialStep =>
    ({ chapter, id, title, instruction, route, target: `[data-tour="${target}"]`, action: "explore" });

  return [
    step(0, "office", "从办公室认识团队", "看看谁在工位上。工位上方出现感叹号时，说明这位队友有任务需要协助。", base, "project-office"),
    step(0, "roles", "弄清大家各自负责什么", "在成员列表确认三个角色。组长安排工作，组员交付任务，老师复核成果与阶段集成。", teamId ? `/teams/${teamId}/members` : "/teams", "team-members"),
    ...(role === "admin" ? [{ ...step(0, "leader-start", "用组长视角查看分工", "确认右上角选中「组长本人」。如果还在其他视角，从菜单切回组长。", base, "project-view-switch"), action: "result" as const, completion: "data-tour-leader-view" }] : []),
    ...(role !== "teacher" ? [step(0, "assignments", role === "admin" ? "查看团队分工" : "找到分给自己的任务", "展开一个阶段，查看任务负责人和当前状态。选中任务就能查看执行要求。", `${work}&panel=list`, "console-task-list")] : []),
    step(1, "timeline", "看清任务的先后关系", "沿连线看哪些任务需要等前置成果，哪些可以并行。点击任意节点可以查看任务详情。", `${base}/timeline`, "timeline-tree"),
    step(1, "help", "在协作中心查看阻塞", helpTaskId ? "看清这项任务卡在哪里、谁负责、需要队友提供什么。可以展开求助说明查看具体情况。" : "这里集中展示项目中尚未解决的求助。团队发起任务求助后，可以在这里查看负责人和需要的协助。", help, "collaboration-help"),
    ...(role !== "teacher" ? [step(2, "delivery", "核对任务的交付要求", taskId ? "找到任务目标、完成条件和交付材料。组员提交后，任务会进入组长的待审核队列。" : "这里显示任务执行列表。分到任务后，打开详情即可确认目标、完成条件和交付材料。", taskId ? `${work}&task=${taskId}` : `${work}&panel=list`, taskId ? "tutorial-task-detail" : "execution-console")] : []),
    ...(role === "admin" ? [{
      ...step(2, "acceptance", "查看组长的成果验收", acceptance
        ? "查看示例任务的提交说明和成果材料。也可以返回列表，选一个任务继续查看。"
        : "从待审核或已审核列表选择任务，查看提交说明和成果材料。队列为空时可以继续下一步。", review, "execution-console"),
      browseAcceptance: true,
    }] : []),
    ...(role === "teacher" ? [
      step(2, "review", "在老师视角复核成果", "在成果验收页查看已完成任务及其证据。选择任务后，可以核对组长的验收结果。", `${work}&panel=list`, "execution-console"),
      step(2, "integration", "检查阶段集成材料", "找到集成分支、测试记录和审核意见。阶段集成审核通过后，团队可以推进下一阶段。", `${work}&panel=list`, "stage-tasks"),
    ] : []),
    step(3, "versions", "比较每一轮的功能变化", "在迭代页查看每个版本交付了哪些模块。点开版本或模块，看看功能怎样一轮轮演进。", `${base}/iterations`, "project-iterations"),
    step(3, "retrospective", "用成果和验收记录做复盘", "看看哪些工作已有验收证据，哪些问题需要在下一轮解决。以后可以从侧栏「项目复盘」按项目打开报告。", `${base}/retrospective`, "retrospective"),
  ];
}
