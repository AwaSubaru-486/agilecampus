import type { TutorialStep, TutorialRole } from "./catalog";

export const WELCOME_VERSION = 10;
export const WELCOME_CHAPTERS = [
  { title: "目录、成员与分工", description: "从目录进入示例项目，在真实成员名单和分工里确认角色。" },
  { title: "我的任务与交付", description: "从办公室查看待做任务和求助，再打开任务核对完成条件。" },
  { title: "阶段进度与时间线", description: "看阶段进度，定位任务并在小窗查看上下游信息。" },
  { title: "角色视角与验收", description: "对照组员、老师和组长看到的工作、验收与推进入口。" },
  { title: "协作、记录与复盘", description: "从 AI 助手和项目记录回看工作，翻阅版本与复盘报告后返回目录。" },
] as const;

export type TutorialJourney = {
  version: 4 | 5 | 6 | 7 | 8 | 9 | typeof WELCOME_VERSION;
  teamId: string | null;
  projectId: string | null;
  taskId?: string | null;
  taskTitle?: string;
  helpTaskId?: string | null;
  helpTaskTitle?: string;
  acceptance?: { taskId: string; title?: string; queue: "review" | "completed" } | null;
  reviewedTask?: { taskId: string; title: string } | null;
  role?: TutorialRole;
};
export const EMPTY_JOURNEY: TutorialJourney = { version: WELCOME_VERSION, teamId: null, projectId: null };

export function welcomeMinutes(steps: TutorialStep[]) {
  return Math.round(steps.reduce((seconds, step) => seconds + (step.guide?.seconds ?? 0), 0) / 60);
}

type WelcomeOptions = Pick<TutorialStep, "action" | "completion" | "browseAcceptance" | "preferredTarget" | "fallbackTarget" | "reopenFrom">
  & Pick<NonNullable<TutorialStep["guide"]>, "check">;

export function buildWelcomeSteps(journey: TutorialJourney): TutorialStep[] {
  const { teamId, projectId, taskId, taskTitle, helpTaskId, helpTaskTitle, acceptance, reviewedTask, role = "admin" } = journey;
  const leader = role === "admin";
  const teacher = role === "teacher";
  const member = role === "student";
  const base = projectId ? `/projects/${projectId}` : "/projects";
  const team = teamId ? `/teams/${teamId}/members` : "/teams";
  const mine = `${base}?space=work&scope=mine`;
  const work = leader ? `${base}?space=work&scope=all` : mine;
  const help = projectId ? `/collaboration?project=${projectId}${helpTaskId ? `&task=${helpTaskId}#task-${helpTaskId}` : "#help"}` : "/collaboration";
  const timeline = `${base}/timeline`;
  const iterations = `${base}/iterations`;
  const retrospective = `${base}/retrospective`;
  const review = `${base}?space=work&scope=${acceptance?.queue ?? "review"}${acceptance ? `&task=${acceptance.taskId}` : "&panel=list"}`;
  const reviewed = leader ? reviewedTask : acceptance;
  const completed = `${base}?space=work&scope=completed${reviewed ? `&task=${reviewed.taskId}` : ""}`;
  const management = `${base}?space=home&view=manage`;
  const helpTarget = helpTaskId ? `collaboration-help-task-${helpTaskId}` : "collaboration-help";
  const consoleFallback = '[data-tour="execution-console"]';
  const helpFallback = '[data-tour="collaboration-help"]';
  const timelineEmpty = '[data-tour="timeline-tree"][data-tour-empty="true"]';
  const step = (chapter: number, id: string, title: string, route: string, target: string, seconds: number, instruction: string, handoff: string,
    { check, action = "explore", ...options }: Partial<WelcomeOptions> = {}): TutorialStep =>
    ({ chapter, id, title, route, target: `[data-tour="${target}"]`, action, instruction, guide: { seconds, handoff, check }, ...options });

  // Keep the Oct 12 walkthrough's core steps in order and insert current features beside the steps they extend.
  return [
    step(0, "directory", "从教程目录进入敏捷开发平台", "/tutorials", "tutorial-showcase", 6,
      "这次用「敏捷开发平台」的真实成员、任务和交付记录练习。先看看目录中的路线和当前角色。",
      "打开成员名单，确认团队里谁负责分工、交付和复核。"),
    step(0, "roles", "认识项目里的三种角色", team, teamId ? "team-members" : "teams", 11,
      "在真实名单里找一位组长、组员和老师。组长安排分工并验收，组员负责交付，老师复核已验收成果和阶段集成。",
      leader ? "回到项目，先切到组长本人，再查看分工。" : member ? "回到办公室，看看分到自己手里的工作。" : "打开项目的求助列表，看看团队有哪些事项需要协助。"),
    ...(leader ? [
      step(0, "leader-start", "进入组长工作区", base, "project-view-switch", 8,
        "确认「操作视角」选择的是「组长本人」。稍后会再切到组员和老师视角。",
        "先从分工查看整组任务，找到负责每项工作的人。", { action: "result", completion: "data-tour-leader-view" }),
      step(0, "assignments", "查看组长安排的分工", `${work}&panel=list`, "console-task-list", 9,
        "展开一项阶段分组，核对任务标题、负责人和状态。需要调整时，组长可在任务详情的「任务资料与管理」里下派或改派。",
        "分工是团队的总表。接下来到办公室看个人工作和队友求助。"),
    ] : []),

    ...(!teacher ? [
      step(1, "board", "回到办公室的任务看板", base, "project-office", 8,
        "在办公室找到「我的任务」，再观察工位上方的感叹号。它提示有队友的工作需要协助。",
        "打开「我的任务」，看看办公室把哪些信息放在一起。"),
      step(1, "board-open", "点开办公室的「我的任务」", base, "member-board-trigger", 7,
        "点击办公场景里的「我的任务」。",
        "弹窗把自己的任务和项目求助并排显示。", { action: "click" }),
      step(1, "board-close", "查看待做任务与求助", base, "office-tasks-close", 9,
        "「待做任务」合计你负责的待办和进行中任务。「求助」显示项目内仍需协助的任务数。右边的协作中心能看到具体是谁需要帮助。看完关闭。",
        "到协作中心打开一条求助，看看需要交接什么。", { action: "click", reopenFrom: "board-open" }),
    ] : []),
    step(1, "help", "在协作中心打开求助详情", help, helpTarget, 10,
      helpTaskTitle ? `看看「${helpTaskTitle}」卡在哪里，以及对方需要什么材料或协助。`
        : "展开一条未解决的求助，找出负责人和需要的协助。没有求助时可以继续。",
      teacher ? "接下来去时间线，确认团队推进到哪个阶段。" : "回到「我的任务」，从列表打开一项具体工作。", { fallbackTarget: helpFallback }),
    ...(!teacher ? [
      step(1, "task-list", "打开「我的任务」列表", `${mine}&panel=list`, "console-task-list", 8,
        "这里按阶段组织分到当前视角的任务。展开一个阶段，看看哪些工作需要自己继续。",
        leader ? "继续打开一项真实任务。自己的列表为空时，也可以从组长的分工查看队友的任务。" : "打开一项自己的任务，读它的交付要求。"),
      step(1, "select", "打开列表中的一项真实任务", work, "console-task", 9,
        taskTitle ? `可点击高亮的「${taskTitle}」，也可以从列表选另一项。后续会沿用刚打开的任务。`
          : "展开一个阶段，点开一项可见任务。列表为空时可以继续。",
        "在详情里核对目标、负责人和完成条件。", {
          action: "click",
          preferredTarget: taskId ? `[data-tour="console-task"][data-tour-task-key="${taskId}"]` : undefined,
        }),
      step(1, "delivery", "核对任务要求与交付方式", work, "tutorial-task-goal", 13,
        "对照「任务目标」「完成条件」和「交件要求」。有执行权限时从详情提交任务，附分支与所需证据，随后由组长验收。",
        "试着为一条完成条件挑一份别人能复核的证据。", { fallbackTarget: consoleFallback, reopenFrom: "select" }),
      step(1, "evidence-plan", "为完成条件挑一份证据", work, "tutorial-task-criteria", 15,
        "用「提交无效内容时出现错误提示」这条完成条件做个小练习。",
        "接下来从单项任务切到时间线，看看阶段整体的验收情况。", {
          fallbackTarget: consoleFallback, reopenFrom: "select",
          check: {
            question: "哪份材料能用于验收？",
            choices: [
              { text: "一张正常首页截图。", feedback: "这张截图看不到无效输入触发的提示。" },
              { text: "一份包含无效输入、提交步骤和实际提示的记录。", feedback: "验收人可以重现操作、核对结果。" },
            ],
            correct: 1,
          },
        }),
    ] : []),

    step(2, "stages", "看当前阶段的验收进度", timeline, "stage-progress", 8,
      "对照当前阶段、已验收任务数和待处理事项。阶段集成通过后，后续阶段才会开放。",
      "在同一页的连续任务树里看具体任务如何衔接。"),
    step(2, "timeline", "在连续任务树里查看全项目", timeline, "timeline-tree", 10,
      "从左向右顺着一条连线找前置成果和后续任务，再看看哪些工作可以并行。没有连线时先看阶段划分。",
      "用图上方的阶段按钮定位到一段工作。"),
    step(2, "stage", "亲自定位一个阶段", timeline, "stage-link", 8,
      "点击一个阶段名称，观察任务树滚动到对应位置。",
      "接下来点开一个节点，核对这项任务的要求。", { action: "click", fallbackTarget: timelineEmpty }),
    step(2, "timeline-node", "打开时间线上的任务小窗", timeline, "timeline-node", 8,
      "点亮起的任务节点打开小窗。也可以查看其他节点。",
      "小窗会显示负责人、目标和完成条件。", {
        action: "click", fallbackTarget: timelineEmpty,
        preferredTarget: helpTaskId ? `[data-tour="timeline-node"][data-tour-task-key="${helpTaskId}"]` : undefined,
      }),
    step(2, "timeline-detail", "在小窗核对任务信息", timeline, "timeline-inspector", 9,
      "找一条完成条件，再看看当前状态、已有交付材料或验收意见。想一想后续任务需要拿到其中哪份成果。",
      "读完以后关掉小窗，回到时间线。", { fallbackTarget: timelineEmpty, reopenFrom: "timeline-node" }),
    step(2, "timeline-close", "关闭小窗回到时间线", timeline, "timeline-close", 6,
      "点击小窗里的「关闭」。",
      leader ? "接下来切到组员和老师视角，对比各自能看到的入口。" : teacher ? "接下来从老师的成果验收入口看一份已验收交付。" : "回到个人任务，看看提交后从哪里读验收结果。",
      { action: "click", fallbackTarget: timelineEmpty, reopenFrom: "timeline-node" }),

    ...(leader ? [
      step(3, "member-view", "切换到一位具体组员的视角", base, "project-view-switch", 8,
        "在「操作视角」选择一位组员。可以选刚才求助的队友；没有组员时可直接继续。",
        "看看这位成员在「我的任务」中能看到哪些工作。", { action: "result", completion: "data-tour-member-preview-ready" }),
      step(3, "member-tasks", "查看这位组员的任务", `${mine}&panel=list`, "console-task-list", 8,
        "按阶段查看当前成员的任务，对比刚才组长所见的整组分工。待验收表示组员已提交，正在等组长处理。",
        "接下来切到老师视角，看看验收通过的成果到哪里复核。"),
      step(3, "teacher-view", "切换到一位老师的视角", base, "project-view-switch", 8,
        "在「操作视角」选择一位老师。团队暂无老师时，可用组长视角继续看已审核成果。",
        "老师的成果验收入口会展示已经通过组长验收的任务。", { action: "result", completion: "data-tour-teacher-preview-ready" }),
    ] : []),
    ...(!member ? [
      step(3, "review", "查看老师复核的已验收成果", completed, "tutorial-task-evidence", 12,
        reviewed?.title ? `查看「${reviewed.title}」的交付材料和验收意见，找出一项可以按证据重新核对的结果。`
          : "打开一项已验收成果，核对交付材料和原验收意见。队列为空时先认识入口。",
        "单个任务通过验收后，多个成果还需要一起做阶段集成。", { fallbackTarget: consoleFallback }),
      step(3, "integration", "查看同页的阶段集成审核", completed, "stage-tasks", 11,
        "找一份集成分支、测试摘要和审核结果。列表为空时，先记下团队要准备这些材料。",
        leader ? "切回组长，到项目推进台找下一步要处理的工作。" : "接下来去成果与记录，确认这些已审核材料在哪里留档。"),
    ] : [step(3, "member-feedback", "找到自己的提交和验收反馈", `${mine}${acceptance ? `&task=${acceptance.taskId}` : ""}`, "tutorial-task-evidence", 12,
      "打开自己的待验收或已完成任务，回看交付证据和验收意见。没有交付时，先记住在任务详情里查找。",
      "接下来看看 AI 助手里从哪里带着任务背景继续讨论。", { fallbackTarget: consoleFallback })]),
    ...(leader ? [
      step(3, "leader-view", "返回组长本人", base, "project-view-switch", 7,
        "将「操作视角」切回「组长本人」。",
        "接下来打开项目推进台，看分工、求助与待验收事项。", { action: "result", completion: "data-tour-leader-view" }),
      step(3, "management", "用项目推进台看下一步", management, "project-home", 10,
        "在推进台找出当前阶段最需要处理的一件事，可以从待验收、阻塞与阶段集成里挑。",
        "进入成果验收，看待审核任务的材料够不够。"),
      step(3, "acceptance", "回到组长的成果验收", review, "tutorial-task-evidence", 12,
        acceptance?.title ? `对照「${acceptance.title}」的完成条件和交付证据，找出可以通过的依据，或想一句能执行的补交意见。`
          : "在待审核或已审核队列打开一项交付，核对完成条件与证据。队列为空时先熟悉两个入口。",
        "如果需要围绕一项任务讨论，在 AI 助手里可以带着项目上下文接着聊。", { browseAcceptance: true, fallbackTarget: consoleFallback }),
    ] : []),

    ...(!teacher ? [step(4, "ai", "打开 AI 助手的项目对话", `${base}?space=studio&view=chat`, "ai-workspace", 10,
      "找到项目对话和关联任务的位置。需要讨论时可以先选任务、确认上下文，再发消息。练习到找到入口即可。",
      leader ? "过程里的成果和证据可以在项目档案里追溯。" : "接下来查看已经验收的交付如何进入迭代。")] : []),
    ...(!member ? [
      step(4, "records", "在成果与记录找回交付依据", `${base}?space=record`, "project-records", 9,
        "挑一份归档成果或证据，确认下次接手的人从哪里能找到它。",
        "项目活动流可以进一步追查交付和审核发生的顺序。"),
      step(4, "activity", "在活动流追溯过程", `${base}/activity`, "activity", 9,
        "找一条分工、提交或验收记录，核对谁在什么时候做了什么。",
        "活动流记录过程，迭代页记录这些成果带来的功能变化。"),
    ] : []),
    step(4, "versions", "从验收成果看版本变化", iterations, "iteration-history", 11,
      "看一项版本变化，比较上一版和这一版能做什么。还没归档的验收成果会自动汇入下方「已验收 · 待归档」。",
      "版本回答做成了什么。用项目复盘看看哪些做法值得带进下一轮。"),
    step(4, "retrospective-generate", "生成项目复盘报告", retrospective, "retrospective-generate", 9,
      "点击「生成报告」，等笔记本翻开。它会读取本项目已有的交付、验收和归档记录。",
      "先读总体评价，再翻页查看具体交付和反馈。", { action: "result", completion: "data-tour-report-ready" }),
    step(4, "retrospective-member", member ? "翻到自己的复盘页" : "翻到一位成员的复盘页", retrospective, "retrospective-pages", 12,
      member ? "先看总体评价，再点「下一页」查看自己的交付与反馈。" : "先看总体评价，再用目录或「下一页」打开一位组长或组员的页面。",
      "参考成员页里的交付和下一步，想一件下轮能检查的事。", { action: "result", completion: "data-tour-member-view", reopenFrom: "retrospective-generate" }),
    step(4, "finish", "返回目录，按功能继续学习", "/tutorials", "tutorial-directory", 7,
      "回到教程目录。刚才看到的时间线、交付、审核、AI 助手和档案，都可以按功能单独复习。",
      "把复盘想到的行动写进下一轮任务的完成条件。"),
  ];
}
