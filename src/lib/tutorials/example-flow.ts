import type { TutorialStep, TutorialRole } from "./catalog";

export const WELCOME_VERSION = 9;
export const WELCOME_CHAPTERS = [
  { title: "接班进办公室", description: "认出工位信号、自己的待办和负责验收的人。" },
  { title: "查清任务为何卡住", description: "读一条求助，再沿时间线判断哪些任务在等它。" },
  { title: "从分工到组员交付", description: "亲自打开任务、选交付证据，再看看组员接到的工作。" },
  { title: "验收与老师复核", description: "检查一份真实交付，再看谁复核成果和阶段集成。" },
  { title: "带着结论进入下一轮", description: "找到版本里的成果，翻开复盘报告，定一条下轮行动。" },
] as const;

export type TutorialJourney = {
  version: 4 | 5 | 6 | 7 | 8 | typeof WELCOME_VERSION;
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
  const work = `${base}?space=work&scope=${leader ? "all" : "mine"}`;
  const help = projectId ? `/collaboration?project=${projectId}${helpTaskId ? `&task=${helpTaskId}#task-${helpTaskId}` : "#help"}` : "/collaboration";
  const helpTarget = helpTaskId ? `collaboration-help-task-${helpTaskId}` : "collaboration-help";
  const timeline = `${base}/timeline`;
  const iterations = `${base}/iterations`;
  const retrospective = `${base}/retrospective`;
  const review = `${base}?space=work&scope=${member ? "mine" : acceptance?.queue ?? (teacher ? "completed" : "review")}${acceptance ? `&task=${acceptance.taskId}` : leader ? "&panel=list" : ""}`;
  const delivery = teacher ? review : work;
  const completedTask = `${base}?space=work&scope=completed${reviewedTask ? `&task=${reviewedTask.taskId}` : ""}`;
  const restoreLeader = `${base}?space=home&view=manage`;
  const helpName = helpTaskTitle ? `「${helpTaskTitle}」` : "这项卡住的任务";
  const deliveryName = teacher ? acceptance?.title : taskTitle;
  const deliveryHeading = deliveryName ? `「${deliveryName}」` : "示例任务";
  const reviewName = acceptance?.title ? `「${acceptance.title}」` : "这份交付";
  const consoleFallback = '[data-tour="execution-console"]';
  const helpFallback = '[data-tour="collaboration-help"]';
  const timelineEmpty = '[data-tour="timeline-tree"][data-tour-empty="true"]';
  const step = (chapter: number, id: string, title: string, route: string, target: string, seconds: number, instruction: string, handoff: string,
    { check, action = "explore", ...options }: Partial<WelcomeOptions> = {}): TutorialStep =>
    ({ chapter, id, title, route, target: `[data-tour="${target}"]`, action, instruction, guide: { seconds, handoff, check }, ...options });

  return [
    step(0, "office", "到办公室接班", base, "project-office", 12,
      "今天的目标是跟着一项任务走完求助、交付和验收。先看看工位上有哪些队友，有没有人头顶亮着感叹号。",
      "先从自己的任务列表确认眼下要做什么，再去看队友需要什么。"),
    ...(leader ? [step(0, "leader-start", "确认正在以组长身份操作", base, "project-view-switch", 8,
      "看「操作视角」是否选中了「组长本人」。如果当前在代看组员或老师，请切回组长。",
      "组长也有自己的待办。点开办公室里的「我的任务」，看看它和团队分工的范围。", { action: "result", completion: "data-tour-leader-view" })] : []),
    step(0, "office-tasks-open", "打开工位上的「我的任务」", base, "member-board-trigger", 10,
      "点办公室里的「我的任务」。弹出的列表只统计当前视角负责的任务。",
      "打开后，先判断自己要先执行一项任务，还是等别人处理验收。", { action: "click" }),
    step(0, "office-tasks-close", "看清自己的任务做到哪了", base, "office-tasks-close", 12,
      "看面板里的「待办」「进行中」「待验收」。挑一项，判断要自己继续做，还是等组长验收。没有分到任务时，熟悉入口后关闭面板。",
      "自己和队友的工作会在提交和验收处交接。先认清负责这两个环节的人。", { action: "click", reopenFrom: "office-tasks-open" }),
    step(0, "roles", "认清谁交付、谁验收", teamId ? `/teams/${teamId}/members` : "/teams", "team-members", 12,
      "在成员名单里找出组长和一位组员。组员对自己的交付负责，组长对照条件验收，老师在已验收成果上给复核意见。",
      "回到刚才的工位信号，看看哪项任务需要队友接力。"),

    step(1, "help", "把感叹号读成一条具体求助", help, helpTarget, 14,
      helpTaskId ? `读${helpName}的求助，找出负责人、卡住的原因和需要的材料或协助。有多条求助时先读第一条。`
        : "有未解决的求助时，展开一条，找出负责人、卡住的原因和需要的协助。列表为空时，直接用下一步的例子练习。",
      "现在把你看到的需求改写成队友能接手的一句话。", { fallbackTarget: helpFallback }),
    step(1, "help-check", "把求助说到别人能接手", help, helpTarget, 15,
      "假设队友负责验证失败提示，但手里缺一份能触发失败的样例。",
      "缺什么已经明确。先到时间线看现在做到哪个阶段，再查后面的任务会不会等这份结果。", {
        fallbackTarget: helpFallback,
        check: {
          question: "发什么消息最有助于解除阻塞？",
          choices: [
            { text: "交付有问题，大家有空来看看。", feedback: "队友还不知道要准备什么。试着说出缺少的样例和用途。" },
            { text: "请提供一个会触发失败的样例，我用它验证提示。", feedback: "这句话说清了需要交接的材料和验证目的。" },
            { text: "先把任务标成完成，后面再补。", feedback: "完成状态不会补齐证据。先让协助者知道需要什么。" },
          ],
          correct: 1,
        },
      }),
    step(1, "stage-progress", "对照当前阶段的验收进度", timeline, "stage-progress", 8,
      "看当前阶段已有几项验收，还有几项没完成。这个数字能帮助你判断问题是否值得优先跟进。",
      "阶段进度显示全局。接下来沿连线找这项求助可能影响的后续任务。"),
    step(1, "timeline", "判断卡住会影响谁", timeline, "timeline-tree", 11,
      "从左向右沿一条连线找前置和后续任务。说出哪项工作要等前面的成果，再看看旁边有没有能同时推进的任务。没有连线时，先读阶段划分。",
      "任务跨阶段时，可用图上方的阶段按钮快速定位。"),
    step(1, "stage-jump", "亲自定位一个阶段", timeline, "stage-link", 8,
      "点击上方任一个阶段名称，观察任务树滚动到对应位置。定位只改变你正在看的位置。",
      "回到求助对应的节点，确认它准备交给下游哪份成果。", { action: "click", fallbackTarget: timelineEmpty }),
    step(1, "timeline-node", "打开任务节点", timeline, "timeline-node", 10,
      `如果在图中看到${helpName}，点开它。也可以点亮起的示例节点，查看一项任务的真实详情。`,
      "打开后，读它的负责人和完成条件，确认它会交给下游什么。", {
        action: "click", fallbackTarget: timelineEmpty,
        preferredTarget: helpTaskId ? `[data-tour="timeline-node"][data-tour-task-key="${helpTaskId}"]` : undefined,
      }),
    step(1, "timeline-read", "从节点读出要交接的成果", timeline, "timeline-close", 12,
      "在详情里读「负责人」和「完成条件」。想一想后续任务接到哪份成果才能开始。看完点「关闭」。",
      teacher ? "接下来打开一份已验收成果，按任务目标和完成条件回读这次交付。" : "接下来到工作区，按负责人、目标、完成条件的顺序读任务。", { action: "click", fallbackTarget: timelineEmpty, reopenFrom: "timeline-node" }),

    ...(!teacher ? [
      step(2, "assignments", "定位任务和负责人", `${work}&panel=list`, "console-task-list", 12,
        leader ? `在分工中找${deliveryHeading}的负责人和状态。列表按阶段分组，必要时展开分组。`
          : "在「我的任务」列表找自己的待办、进行中或待验收任务。列表为空的话，记住从这里找分给自己的工作。",
        "接下来亲手点开列表中的任务，后面的练习会沿用你打开的那一项。"),
      step(2, "choose-task", "在任务列表打开一个真实任务", work, "console-task", 10,
        taskId ? `点击亮起的${deliveryHeading}，也可以选择列表里的另一项任务。` : "展开一个阶段，点开一项任务。如果列表为空，继续用接下来的示例练习。",
        "在选中的任务里，确认目标和一条可以检查的完成条件。", {
          action: "click",
          preferredTarget: taskId ? `[data-tour="console-task"][data-tour-task-key="${taskId}"]` : undefined,
        }),
    ] : []),
    step(2, "delivery", "把任务目标读成可验证的条件", delivery, "tutorial-task-goal", 15,
      teacher && deliveryName ? `读${deliveryHeading}的任务目标，找出原本应达到的一条完成条件。` : "读刚打开的任务目标，再找一条「完成条件」。试着说出做什么操作、看到什么结果才算达标。没写条件时，用下一步的示例练习。",
      "选定条件后，找一份能重现操作并看清结果的证据。", { fallbackTarget: consoleFallback, reopenFrom: teacher ? undefined : "choose-task" }),
    step(2, "evidence-plan", "给完成条件选一份证据", delivery, "tutorial-task-criteria", 17,
      "以「提交无效内容时，页面显示错误提示」为例，准备好交付时要附的材料。",
      leader ? "条件和证据都明确了。切到组员视角，看看负责人接到的任务是什么样。" : teacher ? "现在用同样的方法复核一份已经验收的交付。" : "现在打开已有交付，看看实际提交的材料能证明哪条条件。", {
        fallbackTarget: consoleFallback,
        reopenFrom: teacher ? undefined : "choose-task",
        check: {
          question: "哪份材料能证明条件达成？",
          choices: [
            { text: "一张显示正常首页的截图。", feedback: "正常首页没有展示无效提交的行为，证据要对准这条条件。" },
            { text: "一句「错误提示已完成」。", feedback: "这是一句交付说明。还需要可以核对的输入和结果。" },
            { text: "无效输入、提交步骤和实际提示的录屏或测试结果。", feedback: "验收人可以据此重现操作，并看到实际发生了什么。" },
          ],
          correct: 2,
        },
      }),
    ...(leader ? [
      step(2, "member-view", "切到交付负责人的组员视角", base, "project-view-switch", 8,
        "在「操作视角」里选一位组员。可优先选择刚才发出求助的成员。团队里暂无组员时可直接继续。",
        "到这位成员的「我的任务」，比较它与组长分工列表的范围。", { action: "result", completion: "data-tour-member-preview-ready" }),
      step(2, "member-tasks", "从组员的「我的任务」检查交付入口", `${base}?space=work&scope=mine&panel=list`, "console-task-list", 10,
        "查看当前成员的列表和任务状态。看到待验收时，说明交付已经交给组长；可点开其他任务看提交入口的位置。",
        "组员提交之后，组长要用刚才练过的办法检查证据。"),
      step(2, "leader-review", "切回组长接收交付", base, "project-view-switch", 8,
        "选择「组长本人」。同一份交付从组员的待验收状态，进入组长的成果验收队列。",
        "打开队列里的真实样例，先把交付和对应任务对上。", { action: "result", completion: "data-tour-leader-view" }),
    ] : []),

    step(3, "acceptance", teacher ? "打开已验收的交付" : member ? "找到自己的交付记录" : "进入成果验收队列", review, "tutorial-task-heading", 12,
      acceptance ? `${reviewName}${acceptance.queue === "review" ? "正在等待验收" : "已完成验收"}。先看标题和负责人，确认手里这份材料对应哪项工作。`
        : member ? "在「我的任务」里找一项待验收或已完成的任务。当前没有交付时，也可以继续用下一步的例子。"
          : "在队列里打开一项已有交付。空队列也可以继续，用下面的例子练如何核对材料。",
      "确认任务后，在同一份交付里对照完成条件和实际证据。", { browseAcceptance: leader, fallbackTarget: consoleFallback }),
    step(3, "acceptance-evidence", "拿实际材料对照刚才的标准", review, "tutorial-task-evidence", 15,
      "在「交付证据」选一项材料，核对它能证明哪条条件。再看提交说明或已有验收意见。没有材料时，把缺的部分说清楚。",
      "如果只交了正常流程的画面，想想怎样给对方一条能照着修改的反馈。", { browseAcceptance: leader, fallbackTarget: consoleFallback }),
    step(3, "acceptance-check", "把验收意见写成能执行的动作", review, "tutorial-task-evidence", 17,
      "假设完成条件要求错误提示，但交付里只有正常流程截图。",
      leader ? "组长验收后，老师还可以复核。切到老师视角看看两道审核之间的关系。"
        : teacher ? "单项验收有了依据，再检查同阶段的成果能否一起运行。" : "通过验收的交付会自动汇入迭代页。接下来找它们如何进入版本。", {
        browseAcceptance: leader, fallbackTarget: consoleFallback,
        check: {
          question: "哪条反馈能让负责人知道怎样补交？",
          choices: [
            { text: "请补录一次无效输入，展示提交后的错误提示。", feedback: "这条反馈说清了缺的场景、要补的材料和检查结果。" },
            { text: "功能看起来不错，先通过。", feedback: "现有材料还没覆盖要求。请先指出具体需要补验的场景。" },
            { text: "退回，再完善一下。", feedback: "负责人不知道从哪里改。可以把缺的验证场景指出来。" },
          ],
          correct: 0,
        },
      }),
    ...(leader ? [
      step(3, "teacher-view", "切到老师视角查看已验收成果", base, "project-view-switch", 8,
        "在「操作视角」里选择一位老师，观察项目入口的变化。暂无老师时，继续以组长身份看已审核交付。",
        "老师会从组长验收通过的交付里抽查成果和验证依据。", { action: "result", completion: "data-tour-teacher-preview-ready" }),
      step(3, "teacher-reviewed", "核对一份通过验收的材料", completedTask, "tutorial-task-evidence", 11,
        reviewedTask ? `查看「${reviewedTask.title}」的交付证据，找一条还能补验的场景。` : "打开一项已审核任务，看看交付证据和验收意见。队列为空时，可以先认清入口。",
        "一项任务可以单独验收，整个阶段还要确认多项成果一起运行。", { fallbackTarget: consoleFallback }),
    ] : []),
    ...(!member ? [step(3, "stage-integration", "查看阶段集成审核", leader ? completedTask : review, "stage-tasks", 12,
      "找一份集成分支、测试摘要和审核结果，想想它验证了哪些成果能一起使用。没有集成记录时，先记下需要准备的材料。",
      leader ? "看完两道审核后切回组长，用推进台确认接下来该先处理什么。" : "通过的成果进入项目记录。接下来确认队友以后到哪里能找到依据。")] : []),
    ...(leader ? [step(3, "leader-restore", "切回组长，确认团队推进入口", restoreLeader, "project-view-switch", 9,
      "选择「组长本人」，看项目推进台恢复分工、阻塞和待验收入口。",
      "接下来去成果与记录，看看验收结果如何留下可追溯的依据。", { action: "result", completion: "data-tour-leader-view" })] : []),

    ...(!member ? [step(4, "records", "在项目档案找回成果依据", `${base}?space=record`, "project-records", 10,
      "在「成果与记录」找一份归档成果或相关证据。确认下次接手的人能从哪里看到交付背景与验收材料。",
      "档案留住具体依据，迭代记录这些成果汇成了什么功能变化。")] : []),
    step(4, "version-sync", "找到自动同步的验收成果", iterations, "iteration-pending", 12,
      "查看「已验收 · 待归档」。找一项带有验收依据的成果。列表为空时，成果可能已随版本归档，也可能还在等待验收。",
      "待归档列表告诉你哪些交付可用。归档版本会说明这些交付带来了什么功能变化。"),
    step(4, "versions", "从单项交付读到版本变化", iterations, "iteration-history", 13,
      "挑一项版本变化，试着说出「上一版能做什么」和「这一版多了什么」。首个版本还没归档时，先想一想刚才的成果可以写成哪条新能力。",
      "版本记下了做成的事。接下来用报告回看过程里还欠哪些证据、哪些做法值得保留。"),
    step(4, "retrospective-generate", "用本轮记录生成复盘报告", retrospective, "retrospective-generate", 10,
      "点击「生成报告」，等笔记本翻开。报告会读取项目现有的交付、验收和归档记录。",
      "翻开后先看总体评价，找出当前最值得跟进的一件事。", { action: "result", completion: "data-tour-report-ready" }),
    step(4, "retrospective-overview", "从总体评价挑一个问题", retrospective, "retrospective-summary", 12,
      "看首屏的总体评价和数据。从待验收、待归档或待跟进里选一项。如果没有待办，就挑一项值得带进下一轮的做法。",
      member ? "翻到个人页，把总体结论和自己的交付反馈对照起来。" : "翻到一位成员的页，把团队结论和一份具体交付对照起来。", { reopenFrom: "retrospective-generate" }),
    step(4, "retrospective-member", member ? "翻到自己的交付页" : "翻到一位成员的交付页", retrospective, "retrospective-pages", 13,
      member ? "点「下一页」或目录里的名字，找到自己的交付和反馈。" : "点「下一页」或目录里的组长、组员。如果之前出现过求助负责人，可以优先看他的页。",
      "用这次交付中看到的证据或反馈，定一个下轮能做、能检查的动作。", { action: "result", completion: "data-tour-member-view", reopenFrom: "retrospective-generate" }),
    step(4, "retrospective", "带一条具体行动进入下一轮", retrospective, "retrospective-action", 13,
      "参考这一页的「下一步」，给下轮任务补一句能核对的条件。比如「提交前用一个无效输入复测，并附上提示截图」。",
      "下一轮从办公室打开任务时，先读这一条条件，再准备对应的交付证据。", { reopenFrom: "retrospective-generate" }),
  ];
}
