import type { TutorialStep, TutorialRole } from "./catalog";

export const WELCOME_VERSION = 7;
export const WELCOME_CHAPTERS = [
  { title: "现场与分工", description: "在办公室发现信号，到分工里找到负责人。" },
  { title: "依赖与求助", description: "顺着任务连线看影响，把工位上的感叹号读成一条具体的求助。" },
  { title: "交付与验收", description: "拿完成条件对照交付材料，判断一项工作能否交接。" },
  { title: "迭代与复盘", description: "看验收成果怎样进入版本，再从报告里挑出下轮行动。" },
] as const;

export type TutorialJourney = {
  version: 4 | 5 | 6 | typeof WELCOME_VERSION;
  teamId: string | null;
  projectId: string | null;
  taskId?: string | null;
  taskTitle?: string;
  helpTaskId?: string | null;
  helpTaskTitle?: string;
  acceptance?: { taskId: string; title?: string; queue: "review" | "completed" } | null;
  role?: TutorialRole;
};
export const EMPTY_JOURNEY: TutorialJourney = { version: WELCOME_VERSION, teamId: null, projectId: null };

export function welcomeMinutes(steps: TutorialStep[]) {
  return Math.round(steps.reduce((seconds, step) => seconds + (step.guide?.seconds ?? 0), 0) / 60);
}

export function buildWelcomeSteps(journey: TutorialJourney): TutorialStep[] {
  const { teamId, projectId, taskId, taskTitle, helpTaskId, helpTaskTitle, acceptance, role = "admin" } = journey;
  const base = projectId ? `/projects/${projectId}` : "/projects";
  const work = `${base}?space=work&scope=${role === "admin" ? "all" : "mine"}`;
  const help = projectId ? `/collaboration?project=${projectId}${helpTaskId ? `&task=${helpTaskId}#task-${helpTaskId}` : "#help"}` : "/collaboration";
  const review = `${base}?space=work&scope=${acceptance?.queue ?? (role === "teacher" ? "completed" : "review")}${acceptance ? `&task=${acceptance.taskId}` : "&panel=list"}`;
  const helpName = helpTaskTitle ? `「${helpTaskTitle}」` : "这项任务";
  const deliveryName = taskTitle ? `「${taskTitle}」` : "示例任务";
  const reviewName = acceptance?.title ? `「${acceptance.title}」` : "这项交付";
  const step = (chapter: number, id: string, title: string, route: string, target: string, seconds: number, instruction: string, handoff: string): TutorialStep =>
    ({ chapter, id, title, route, target: `[data-tour="${target}"]`, action: "explore", instruction, guide: { seconds, handoff } });

  return [
    step(0, "office", "先在工位上发现求助信号", base, "project-office", 20,
      "你刚加入「敏捷开发平台」。先认一位队友的工位，看看头顶有没有感叹号。有感叹号时，说明这位队友有任务需要协助。",
      "先到成员名单认清角色，后面就知道该找谁分工、交付和验收。"),
    step(0, "roles", "认清任务要经过谁的手", teamId ? `/teams/${teamId}/members` : "/teams", "team-members", 25,
      "在名单里找一位组长和一位组员。组长把任务分给负责人并验收交付，组员按条件提交成果，老师可以复核验收结果。",
      role === "admin" ? "接下来回到组长视角，确认整组的任务分给了谁。" : role === "student" ? "接下来打开「我的任务」，看分工落到自己身上是什么样。" : "接下来用时间线确认这些分工怎么接起来。"),
    ...(role === "admin" ? [{
      ...step(0, "leader-start", "切回组长视角", base, "project-view-switch", 15,
        "看「操作视角」是否选中「组长本人」。如果当前在代看组员或老师，切回组长就能看到整组任务和验收队列。",
        "视角确认后，打开分工列表，找到任务、负责人和状态这三个信息。"),
      action: "result" as const, completion: "data-tour-leader-view",
    }] : []),
    ...(role !== "teacher" ? [step(0, "assignments", role === "admin" ? "把分工落到任务负责人" : "认领前先读自己的分工", `${work}&panel=list`, "console-task-list", role === "admin" ? 25 : 40,
      "在列表里展开一个任务分组，找一条任务，读出它的标题、负责人和当前状态。状态可以帮你判断现在要执行、等审核，还是回看已经完成的成果。",
      "列表告诉你谁在做。接下来去时间线，看这些任务谁先做、谁要等。")]: []),
    step(1, "timeline", "顺着一条连线找前置任务", `${base}/timeline`, "timeline-tree", 35,
      "从左往右挑一条有连线的任务链。找出一项任务要等哪份前置成果，再看看旁边哪些任务能同时推进。可点开节点核对负责人和完成条件，看完关闭详情。",
      "知道下游在等什么，就能判断阻塞的影响。现在到协作中心看队友具体缺什么。"),
    step(1, "help", "读懂感叹号背后的求助", help, "collaboration-help", 40,
      helpTaskId ? `找到${helpName}的求助，展开后确认谁负责、卡在哪、需要别人提供什么。试着用一句话说清谁需要哪项帮助。` : "这里集中显示还没解决的求助。有记录时，展开一条，确认谁负责、卡在哪、需要别人提供什么。没有记录时，可以先认一下这个入口。",
      role === "teacher" ? "现在看一份已经完成的交付，核对有哪些材料能证明任务做完了。"
        : taskId && taskId === helpTaskId ? "带着这条求助回到同一项任务，把缺的协助和完成条件对照。"
        : taskId ? `接下来打开${deliveryName}，练习在详情里找完成条件。` : "接下来到执行列表，看看分到任务后去哪里读要求。"),
    ...(role !== "teacher" ? [step(2, "delivery", "把完成条件变成证据清单", taskId ? `${work}&task=${taskId}` : `${work}&panel=list`, taskId ? "tutorial-task-detail" : "execution-console", role === "admin" ? 30 : 60,
      taskId ? `打开的${deliveryName}里，先读「任务目标」，再找一条「完成条件」。想想要用哪种材料证明它达成了，比如测试结果、截图或演示链接。已有证据时，往下对照「交付证据」。`
        : "分到任务后，点开详情读「任务目标」和「完成条件」。试着把一条条件变成一份可核对的材料，比如测试结果或演示截图。",
      role === "admin" ? "提交后的材料会进入待审核。下一步打开已有交付，对照完成条件看看能不能验收。" : "交付通过验收后会进入成果记录。接下来去迭代页看这些成果怎样汇成版本。")]: []),
    ...(role === "admin" ? [{
      ...step(2, "acceptance", "拿提交材料对照验收条件", review, "execution-console", 35, acceptance
        ? `可以先用${reviewName}练习。找一条完成条件和一份「交付证据」，判断材料能否证明条件达成。可切换「待审核 / 已审核」，再选一项比较。导览中只查看即可。`
        : "切换「待审核 / 已审核」，任选一项，把它的完成条件与交付证据对照。队列为空时，先记住从这里找提交，稍后可用真实交付再练。",
      "证据充分的交付通过验收后会出现在迭代页。接下来查看成果怎样归入版本。"),
      browseAcceptance: true,
    }] : []),
    ...(role === "teacher" ? [
      step(2, "review", "复核一份已验收的交付", review, "execution-console", 55,
        acceptance ? `打开的是${reviewName}。找一条完成条件和相应的交付证据，再看组长的验收结果。如果还缺一份材料，想想该给负责人怎样的复核意见。` : "打开一项已完成任务，从完成条件读到交付证据，再核对组长的验收结果。列表为空时，先确认这个入口。",
        "一项任务能交付，也要确认同阶段的成果能一起使用。接下来查看阶段集成。"),
      step(2, "integration", "检查同阶段成果能否一起交付", `${work}&panel=list`, "stage-tasks", 45,
        "在阶段集成审核中查看分支、测试记录和审核意见。挑一份测试记录，判断它能否证明多个任务合到一起仍然可用。没有记录时，记下团队要准备的材料。",
        "单项成果与阶段集成都有了依据，接下来查看版本归档里的功能变化。"),
    ] : []),
    step(3, "versions", "从单项交付看到版本变化", `${base}/iterations`, "project-iterations", 35,
      "先找「已验收 · 待归档」，看看哪些任务成果自动同步到了这里。再选一个已归档版本，对照基准版本看本轮新增或改进了什么。没有归档版本时，先看已验收成果。",
      "版本告诉我们交付了什么。接下来翻开复盘报告，看看哪些做法值得保留、哪些事项要跟进。"),
    step(3, "retrospective", "翻开报告，选出下轮行动", `${base}/retrospective`, "retrospective", 45,
      role === "student" ? "点击「生成报告」，先读总体评价，再翻到自己的页面。找一项有验收反馈的交付，想想下次应该保留哪种做法、补上哪份材料。"
        : "点击「生成报告」，先看总体评价，再用目录或「下一页」翻到一位成员。把那页的一条验收反馈变成可以在下轮核对的行动。",
      "下一轮开始分工前，从侧栏「项目复盘」回来看这条行动，再把它写进对应任务的完成条件。"),
  ];
}
