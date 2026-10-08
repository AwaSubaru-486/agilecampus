import { buildWelcomeSteps, EMPTY_JOURNEY, type TutorialJourney } from "./example-flow";
export type TutorialRole = "admin" | "student" | "teacher";
export type TutorialProject = { id: string; name: string; teamId: string; role: TutorialRole };
export type TutorialProgress = {
  journey?: TutorialJourney;
  example?: {version:1;phase:number;values:Record<string,string>;events:{phase:number;title:string;at:string}[]};
  status: "new" | "dismissed" | "started" | "completed";
  completed: string[];
  active: { courseId: string; step: number; projectId: string | null; paused?: boolean; journeyVersion?: number } | null;
};
export const INITIAL_TUTORIAL_PROGRESS: TutorialProgress = { status: "new", completed: [], active: null };
export const COURSE_IDS = ["welcome","api-config", "teams", "planning", "execution", "review", "iterations", "ai", "records", "timeline", "risks", "resources", "labels", "agents", "connections", "settings"] as const;
export type CourseId = (typeof COURSE_IDS)[number];
export type TutorialStep = {
  id: string; title: string; instruction: string; route: string;
  target: string; completion?: string; action: "click" | "input" | "explore" | "result";
};
export type TutorialCourse = {
  id: CourseId; title: string; description: string; category: string;
  needsProject?: boolean; roles?: TutorialRole[]; steps: TutorialStep[];
};

export function buildTutorialCourses(project: TutorialProject | null, journey: TutorialJourney = EMPTY_JOURNEY): TutorialCourse[] {
  const base = project ? `/projects/${project.id}` : "/projects";
  const team = project ? `/teams/${project.teamId}` : "/teams";
  const work = `${base}?space=work`;
  const step = (id: string, title: string, instruction: string, route: string, target: string, action: TutorialStep["action"] = "explore"): TutorialStep => ({ id, title, instruction, route, target: `[data-tour="${target}"]`, action });
  const courses: TutorialCourse[] = [
    { id: "teams", title: "团队与成员", category: "开始协作", description: "找到团队、邀请码和真实成员角色。", steps: [
      step("team", "找到你的团队", "这里是团队入口。已有邀请码时可以加入团队；自己组织项目时可以创建团队。", "/teams", "teams"),
      step("join", "试着填写邀请码", "在高亮输入框填入邀请码。这里只练习填写，教程不会替你提交加入请求。", "/teams", "team-invite", "input"),
      ...(project ? [step("members", "确认三角色分工", "在成员页找到组长、组员和导师。角色修改入口只对组长开放。", `${team}/members`, "team-members")] : []),
    ] },
    { id: "planning", title: "AI 一键生成任务", category: "任务流程", needsProject: true, roles: ["admin"], description: "输入需求、生成草案、修订分工，再确认发布。", steps: [
      step("brief", "写下本轮需求", "在项目说明里输入目标和交付要求，至少 10 个字。先练习填写，不会自动调用模型。", `${base}/task-tree#planning`, "task-brief", "input"),
      step("generate", "找到生成入口", "你准备好后可点击生成。模型配置齐全时会返回草案；教程不会替你调用模型或发布任务。", `${base}/task-tree#planning`, "task-generate"),
      step("draft", "确认后再发布", "这块区域会展示生成的草案，支持修改负责人、优先级和完成标准。已有草案可直接修订，没有草案时先认识发布流程。", `${base}/task-tree`, "task-drafts"),
    ] },
    { id: "execution", title: "认领与提交任务", category: "任务流程", needsProject: true, roles: ["admin", "student"], description: "选择任务，确认交接要求，再提交成果。", steps: [
      step("console", "打开执行工作区", "点击高亮的任务入口。进入任务详情后可以认领、报告执行情况或提交成果。没有任务时先认识列表，再继续学习流程。", `${work}&panel=list`, "console-task", "click"),
      step("contract", "查看交接与交付", "在高亮执行台里找到负责人、完成条件和证据要求；提交成果会进入待验收，由人审核。", work, "execution-console"),
      step("delivery", "登记交付材料", "任务树中的执行任务可登记分支、提交和 PR。点击任务可回到执行台；锁定阶段要等前一阶段通过。", `${base}/task-tree`, "stage-tasks"),
    ] },
    { id: "review", title: "任务验收与导师评审", category: "任务流程", needsProject: true, roles: ["admin", "teacher"], description: "检查成果，通过或填写原因退回。", steps: [
      step("review", "找到待验收任务", "在执行台查看待验收任务及成果证据。组长或导师可以通过或退回。", work, "execution-console"),
      step("integration", "检查阶段集成", "这里显示集成分支、测试材料和审核记录。非提交者才会看到审核操作；退回必须填写原因。", `${base}/task-tree`, "stage-tasks"),
      ...(project?.role === "teacher" ? [step("evaluation", "打开导师评审", "点击导师评审按钮，查看评分与评语表单。教程只打开表单，不会替你提交评价。", work, "teacher-evaluation", "click"), step("evaluation-close", "退出评审练习", "点击关闭按钮返回项目。只有正式提交才会写入评分与评语。", work, "evaluation-close", "click")] : []),
    ] },
    { id: "iterations", title: "阶段迭代与交接", category: "任务流程", needsProject: true, description: "认识阶段门禁和增量需求。", steps: [
      step("progress", "找到当前阶段", "进度区显示当前阶段、已验收任务与待处理事项。任务验收和阶段集成是两个不同的关口。", `${base}/task-tree`, "stage-progress"),
      step("stage", "切换一个阶段", "点击高亮阶段导航，跳到对应任务。下一阶段只有在集成审核通过后才会解锁。", `${base}/task-tree`, "stage-link", "click"),
      step("handoff", "查看执行与交接资料", "在执行台查看任务契约、运行记录与交接材料。分支信息是登记材料，网页不会自动合并代码。", work, "execution-console"),
      step("retrospective", "用过程记录复盘", "这里汇总交付、验收、求助与成员贡献。没有活动记录时会显示空状态；数据只反映已登记的过程。", `${base}/retrospective`, "retrospective"),
      step("activity", "追溯具体动作", "活动流按时间记录认领、提交、验收等动作，帮助你追溯阶段迭代。", `${base}/activity`, "activity"),
    ] },
    { id: "ai", title: "AI 协作与会话分支", category: "协作与沉淀", needsProject: true, description: "进入项目协同室，认识共享会话和人工确认。", steps: [
      step("studio", "进入 Agent 协作", "点击 Agent 协作入口，进入项目协同室。", work, "nav-studio", "click"),
      step("workspace", "找到会话与确认事项", "在高亮协同室中查看任务关联会话、分支与待确认草案。AI 提议需要人工确认才会写入。", `${base}?space=studio`, "ai-workspace"),
      step("chat", "打开项目会话", "点击项目会话，进入共享会话工作区。", `${base}?space=studio`, "project-chat", "click"),
      step("new-chat", "打开新会话表单", "点击“新会话”，练习设置主题与可见范围。这个动作只打开表单。", `${base}?space=studio&view=chat`, "conversation-toggle", "click"),
      step("chat-title", "写下会话主题", "在亮起的输入框写下本次讨论主题，例如“本轮验收标准”。填写不会创建会话或调用 AI。", `${base}?space=studio&view=chat`, "conversation-title", "input"),
      step("chat-scope", "确认任务与可见范围", "这里可以关联任务，并选择项目成员可见或仅自己可见。正式创建前确认共享范围。", `${base}?space=studio&view=chat`, "conversation-form"),
      step("chat-close", "退出会话练习", "点击“取消”收起表单。需要真实协作时再创建会话。", `${base}?space=studio&view=chat`, "conversation-toggle", "click"),
      step("context-title", "给上下文快照命名", "给这次讨论的资料快照取个名字。快照可以关联任务、里程碑和会话，帮助 AI 获取具体上下文。", `${base}?space=studio&view=chat`, "context-title", "input"),
      step("context", "确认 AI 可以读取哪些资料", "在亮起的区域选择候选来源并预览。正式冻结后，发送消息会使用这份快照；教程不会替你冻结或发送。", `${base}?space=studio&view=chat`, "context-builder"),
    ] },
    { id: "records", title: "证据、决策与项目档案", category: "协作与沉淀", needsProject: true, description: "把成果和评审留在可追溯的项目记录中。", steps: [
      step("record", "进入成果记录", "点击成果记录，查看项目文档、交付材料与老师反馈。", work, "nav-record", "click"),
      step("archive", "认识项目档案", "高亮区域汇集成果、证据与决策。需要提交材料时使用页面上的实际操作。", `${base}?space=record`, "project-records"),
      step("library", "查看跨项目资料", "资料库汇集可访问的工程资料，便于查找已有上下文。", "/library", "library"),
    ] },
    { id: "timeline", title: "时间线与里程碑", category: "项目管理", needsProject: true, description: "查看日期、任务依赖和阶段安排。", steps: [step("timeline", "看一次项目时间线", "在高亮时间线中找到任务日期、里程碑和逾期情况。任务日期来自真实项目数据。", `${base}/timeline`, "timeline")] },
    { id: "risks", title: "风险、求助与协作中心", category: "项目管理", description: "找到风险与求助入口，及时向团队说明阻塞。", steps: [
      step("health", "找到项目风险", "风险页面聚合项目健康情况。没有风险数据时会显示空状态。", "/health", "health"),
      step("help", "打开求助面板", "点击高亮的求助按钮，查看阻塞类型与协助人选择。这里只打开面板，不会自动发送求助。", "/collaboration", "help-button", "click"),
      step("help-close", "看完后收起面板", "点击“先不发”，关闭求助面板。需要求助时再按实际情况填写并发送。", "/collaboration", "help-close", "click"),
      step("collaboration", "查看协作中心", "协作中心聚合待回应、待确认与协助事项。", "/collaboration", "collaboration"),
    ] },
    { id: "resources", title: "共享资源占用", category: "项目管理", needsProject: true, description: "填写资源与使用时间，了解登记流程。", steps: [
      step("resource", "填写一个资源名称", "输入你要使用的资源名，例如 GPU-01。填写不会提交占用记录。", `${team}/resources`, "resource-name", "input"),
      step("time", "检查起止时间", "在高亮表单中填写时间和用途，准备好后才自行提交。资源占用采用登记制。", `${team}/resources`, "resource-form"),
    ] },
    { id: "labels", title: "标签与看板", category: "项目管理", needsProject: true, description: "认识团队标签以及任务筛选分组。", steps: [
      step("labels", "查看团队标签", "标签由团队统一管理；普通成员查看，组长维护。", `${team}/labels`, "team-labels"),
      step("board", "找到任务看板", "在高亮看板中查看任务，使用页面筛选和分组。任务完成由验收确认。", `${base}?space=work&view=board`, "task-board"),
    ] },
    { id: "agents", title: "AI 成员与外部执行", category: "连接与工具", needsProject: true, description: "查看 AI 成员和运行记录。", steps: [
      step("agents", "认识团队 AI 成员", "AI 可以被分配任务、汇报结果与阻塞；验收仍由人负责。", `${team}/agents`, "team-agents"),
      step("runs", "查看执行记录", "执行台把任务、Agent 运行和交接材料关联起来。外部工具的真实执行需要连接对应环境。", work, "execution-console"),
    ] },
    { id: "connections", title: "令牌、VS Code 与会话记忆", category: "连接与工具", description: "找到外部工具连接入口，区分网页与本地能力。", steps: [
      step("token", "为连接填写名称", "给外部工具连接取个名称，例如“我的 VS Code”。这里只填写名称，不会创建令牌。", "/settings/tokens", "token-name", "input"),
      step("tokens", "认识令牌管理", "这里管理外部程序的访问令牌。生成、复制或撤销均由你按需操作。VS Code 的采集与记忆命令在本地扩展中执行。", "/settings/tokens", "token-manager"),
      ...(project ? [step("checkpoint", "找到网页中的交接资料", "在执行台查看检查点、契约和执行材料。网页教程不会安装扩展或自动恢复外部 Agent。", work, "execution-console")] : []),
    ] },
    { id: "api-config", title: "配置模型 API", category: "连接与工具", description: "保存个人模型服务地址、模型名称和密钥。", steps: [step("api", "连接模型服务", "填写并保存配置。已有配置可继续；保存不会自动调用模型。", "/settings/api", "api-config", "result")] },
    { id: "settings", title: "账号与飞书通知", category: "连接与工具", description: "找到账号设置和通知绑定入口。", steps: [step("settings", "查看账号设置", "在高亮设置区查看飞书绑定与通知配置。外部账号绑定按页面流程由你完成。", "/settings", "settings")] },
  ];
  const welcome: TutorialCourse = {
    id:"welcome",title:"在真实页面做一个示例项目",category:"推荐起点",description:"先配置模型 API，再创建团队与项目，在原有页面生成、修订、发布和提交任务，再认识验收与迭代。",
    steps:buildWelcomeSteps(journey),
  };
  return [welcome, ...courses];
}
