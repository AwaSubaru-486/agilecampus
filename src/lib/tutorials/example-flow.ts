import type { TutorialStep } from "./catalog";

export type TutorialJourney = {version:4|5;teamId:string|null;projectId:string|null;taskId?:string|null};
export const EMPTY_JOURNEY: TutorialJourney = {version:5,teamId:null,projectId:null};
export const LEGACY_WELCOME_IDS = ["api", "team", "roles", "project", "brief", "generate", "draft", "publish", "stages", "select", "claim", "submit", "review", "integration", "ai", "resource", "records", "iteration", "directory"];
export function welcomeStepIndex(id: string) {
  const index = buildWelcomeSteps(EMPTY_JOURNEY).findIndex(step => step.id === id);
  if (index < 0) throw new Error(`Unknown tutorial step: ${id}`);
  return index;
}
// Expanded forms and unsaved edits do not survive leaving the planning page.
export function welcomeResumeIndex(index: number) {
  return index >= welcomeStepIndex("node") && index <= welcomeStepIndex("save")
    ? welcomeStepIndex("draft") : index;
}

export function buildWelcomeSteps(journey:TutorialJourney):TutorialStep[] {
  const team=journey.teamId ? `/teams/${journey.teamId}` : "/teams";
  const base=journey.projectId ? `/projects/${journey.projectId}` : "/projects";
  const planning=`${base}/task-tree?plan=1#planning`;
  const work=`${base}?space=work${journey.taskId ? `&task=${journey.taskId}` : ""}`;
  const step=(id:string,title:string,instruction:string,route:string,target:string,action:TutorialStep["action"]="explore",completion?:string):TutorialStep=>({id,title,instruction,route,target:`[data-tour="${target}"]`,action,completion});
  return [
    step("api","先配置模型 API","在真实配置页填写 API 地址、模型名称和 API Key，然后保存。已有个人或站点默认配置时可以继续；教程不会自动调用模型。","/settings/api","api-config","result"),
    step("team","在我的团队创建示例团队","在原有创建表单填入“新手练习团队”并点击创建。它会保存在你的团队列表；教程不会改动已有团队。","/teams","team-create","result"),
    step("roles","认识真实成员与三种分工","组长规划与分工，组员执行并交付，导师评审与验收。这里是实际成员管理页，可用邀请码邀请同伴；教程不会创建虚假成员或更改角色。",`${team}/members`,"team-members"),
    step("project","在团队项目页创建项目","使用原有创建表单，项目名称建议“教学示例：校园活动报名页”，描述写清报名表单与必填校验的目标。创建后会出现在原项目列表。",`${team}/projects`,"project-create","result"),
    step("brief","写下项目需求","在原有项目说明输入框填写：制作校园活动报名页，支持填写姓名与联系方式，缺少必填信息时提示错误，成功后显示回执。",planning,"task-brief","input"),
    step("generate","从需求生成草案","点击这里的生成按钮。这个新建教学项目使用固定模板演示，不需要模型配置；正式项目仍调用你配置的模型。保存成功才继续。",planning,"planning-form","result"),
    step("draft","沿着连续任务树看规划","所有阶段在同一张图里，从左往右推进。并行分支会汇合，阶段用竖向虚线分开。教学模板预设了演示连线；正式项目由 AI 分析并复核。",`${base}/task-tree`,"draft-tree"),
    step("node","打开一个任务节点","点击亮起的节点，下方会展开负责人、执行说明与验收标准。",`${base}/task-tree`,"draft-node","click"),
    step("details","检查任务与连接理由","在这里修订任务、负责人和验收标准，展开前置任务能看到连接理由。拖动节点上的手柄可调整分支；AI 重新安排与复核会真实调用已配置的模型，不必在练习中等待。",`${base}/task-tree`,"draft-inspector"),
    step("add","在当前任务后接入新任务","点击节点后方的加号，练习把一个补充任务接入分支。",`${base}/task-tree`,"draft-add-selected","click"),
    step("add-name","给补充任务起个名字","填写“验证重复报名提示”。AI 可以结合项目目标检查它是否适合接在这里，并完善标准；这次先手动完成练习。",`${base}/task-tree`,"draft-new-name","input"),
    step("add-criteria","写下可检查的完成标准","填写“重复报名时显示清晰提示，并保留已填写的信息”。标准要能通过结果或证据核对。",`${base}/task-tree`,"draft-new-criteria","input"),
    step("add-confirm","确认接入任务树","点击新增表单里的确认添加任务。节点出现后再继续，任务资料还需要保存。",`${base}/task-tree`,"tutorial-draft-editor","result","data-tour-added"),
    step("delete-open","认识节点前方的减号","点击刚添加节点前方的减号。这里只打开二次确认，不会立即删除。",`${base}/task-tree`,"draft-delete-selected","click"),
    step("delete-check","删除前检查影响范围","有后续任务时，可选择保留它们并接回前置，或一起删除，包括跨阶段的后续任务。练习中保留刚添加的任务，下一步点取消。",`${base}/task-tree`,"draft-delete-dialog"),
    step("delete-cancel","取消本次删除","点击取消，回到任务树。",`${base}/task-tree`,"draft-delete-cancel","click"),
    step("save","保存任务和编排","点击保存修改与编排。任务资料保存到项目，规划连线保存在当前浏览器；保存成功后才能发布。",`${base}/task-tree`,"tutorial-draft-editor","result","data-tour-saved"),
    step("publish","亲手确认并发布","在原有草案区域点击确认并发布。未保存的修改必须先保存。发布成功后，任务与阶段进入这个项目的真实执行列表。",`${base}/task-tree`,"task-drafts","result"),
    step("timeline","在时间线查看整条任务链","同一份已发布任务在这里连续展开。阶段按钮只定位图中位置，不拆开任务链；可以缩放和滚动。教学编排会从当前浏览器恢复。",`${base}/timeline`,"timeline-tree"),
    step("timeline-node","查看已发布任务的要求","点击亮起的任务节点，查看负责人、状态与连接理由。",`${base}/timeline`,"timeline-node","click"),
    step("timeline-detail","从树上回到实际任务","节点详情会显示验收标准，也提供打开执行任务的入口。这里只查看，稍后再接住任务。",`${base}/timeline`,"timeline-inspector"),
    step("member-view","切换到组员视角","在亮起的查看视角中选择“组员（预览）”。观察首页和导航如何围绕个人交付展开；任务仍按你本人展示。",base,"project-view-switch","result","data-tour-member-view"),
    step("teacher-view","切换到老师视角","选择“老师（预览）”，观察成果验收和集成审核入口。预览不更改成员角色，也不允许提交实际评审。",base,"project-view-switch","result","data-tour-teacher-view"),
    step("leader-view","切回组长继续推进","选择“组长”恢复规划与管理功能。回到组长视角后，继续接住并提交练习任务。",base,"project-view-switch","result","data-tour-leader-view"),
    step("stages","查看本轮与下一轮","当前阶段可执行，后一阶段显示未解锁。任务验收与阶段集成分别审核，前一阶段集成通过后才开放下一阶段。",`${base}/task-tree`,"stage-progress"),
    step("select","打开第一项执行任务","点击当前阶段的报名表单任务，进入原有执行台详情。这里会展示目标、完成标准、交接要求与动作入口。",`${base}/task-tree`,"tutorial-stage-task","click"),
    step("claim","接住任务并确认计划","在亮起的任务详情找到认领区域，填写执行计划，再点击确认接住。组长也可承担执行任务；正式组员使用同样的入口。",work,"tutorial-task-detail","result","data-tour-claimed"),
    step("submit","提交你的练习成果","在原有提交表单填写成果说明，例如“练习证据：已核对必填缺失与正常提交两种验收场景”。提交会进入待验收。此处是练习记录，请勿写成已实际完成代码。",work,"tutorial-task-detail","result","data-tour-submitted"),
    step("review","认识验收入口与导师职责","现在查看待验收状态、证据和通过/退回入口。真实审核由有权限的组长或导师完成；不需要在教程里伪造导师审核，也不会替你自动通过。",work,"tutorial-task-detail"),
    step("integration","查看交付分支与阶段集成","回到规划页，找到任务交付分支与阶段集成区域。任务全部验收且登记交付后，组长才能提交集成；另一位组长或导师审核。可以先认识流程，稍后与同伴完成。",`${base}/task-tree`,"stage-tasks"),
    step("ai","找到任务关联的 AI 协作","这里是原有 Agent 协同室，查看会话与待确认事项。真实 AI 讨论需要配置模型；教程只带你认识入口和任务背景，不会自动发送消息。",`${base}?space=studio${journey.taskId ? `&task=${journey.taskId}` : ""}`,"ai-workspace"),
    step("resource","查看团队共享资源","在原有资源页登记设备、场地或共享资料的使用情况。这里与刚创建的团队关联，避免资源入口与项目流程脱节。",`${team}/resources`,"resource-form"),
    step("records","回看你刚才的过程","原有复盘页汇总这个项目的认领、提交和贡献。你已经在真实页面留下练习记录；导师验收与集成需要实际协作者继续完成。",`${base}/retrospective`,"retrospective"),
    step("iteration","回到下一轮需求入口","打开原有规划表单，认识下一轮新增需求的入口，例如增加报名成功回执。新增阶段仍会等待上一阶段集成审核，网页不会自动合并代码。",planning,"planning-form"),
    step("directory","以后按功能复习","侧栏的新手教程保留目录入口。选择这个新建项目后，可以单独复习生成任务、执行、评审、AI 与其他功能。","/tutorials","tutorial-directory"),
  ];
}
