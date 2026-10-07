import type { TutorialStep } from "./catalog";

export type TutorialJourney = {version:3;teamId:string|null;projectId:string|null;taskId?:string|null};
export const EMPTY_JOURNEY: TutorialJourney = {version:3,teamId:null,projectId:null};

export function buildWelcomeSteps(journey:TutorialJourney):TutorialStep[] {
  const team=journey.teamId ? `/teams/${journey.teamId}` : "/teams";
  const base=journey.projectId ? `/projects/${journey.projectId}` : "/projects";
  const planning=`${base}/task-tree?plan=1#planning`;
  const work=`${base}?space=work${journey.taskId ? `&task=${journey.taskId}` : ""}`;
  const step=(id:string,title:string,instruction:string,route:string,target:string,action:TutorialStep["action"]="explore",completion?:string):TutorialStep=>({id,title,instruction,route,target:`[data-tour="${target}"]`,action,completion});
  return [
    step("team","在我的团队创建示例团队","在原有创建表单填入“新手练习团队”并点击创建。它会保存在你的团队列表；教程不会改动已有团队。","/teams","team-create","result"),
    step("roles","认识真实成员与三种分工","组长规划与分工，组员执行并交付，导师评审与验收。这里是实际成员管理页，可用邀请码邀请同伴；教程不会创建虚假成员或更改角色。",`${team}/members`,"team-members"),
    step("project","在团队项目页创建项目","使用原有创建表单，项目名称建议“教学示例：校园活动报名页”，描述写清报名表单与必填校验的目标。创建后会出现在原项目列表。",`${team}/projects`,"project-create","result"),
    step("brief","写下项目需求","在原有项目说明输入框填写：制作校园活动报名页，支持填写姓名与联系方式，缺少必填信息时提示错误，成功后显示回执。",planning,"task-brief","input"),
    step("generate","从需求生成草案","点击这里的生成按钮。这个新建教学项目使用固定模板演示，不需要模型配置；正式项目仍调用你配置的模型。保存成功才继续。",planning,"planning-form","result"),
    step("draft","修订任务与负责人","这是原有草案编辑器。修改第一项任务标题、查看负责人和完成标准；有修改时点击保存修改。负责人选自己，方便继续练习执行。",`${base}/task-tree`,"tutorial-draft-editor"),
    step("publish","亲手确认并发布","在原有草案区域点击确认并发布。未保存的修改必须先保存。发布成功后，任务与阶段进入这个项目的真实执行列表。",`${base}/task-tree`,"task-drafts","result"),
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
