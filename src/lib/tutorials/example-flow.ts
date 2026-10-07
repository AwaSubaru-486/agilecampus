export const EXAMPLE_FLOW = [
  [
    "team",
    "准备协作团队",
    "为练习团队命名，确认组长组织分工、组员执行、导师审核。",
  ],
  [
    "project",
    "创建示例项目",
    "我们将做一个校园活动报名页。给项目命名，后面的任务与成果都属于它。",
  ],
  [
    "brief",
    "从需求生成任务草案",
    "写清目标和完成标准，点击生成示例任务。教学模板不调用付费模型。",
  ],
  [
    "draft",
    "调整任务与负责人",
    "检查草案，把任务改成可交付的工作，并确认负责人的分工。",
  ],
  [
    "publish",
    "确认并发布任务",
    "发布后任务才进入执行列表。AI 草案不会自行变成正式任务。",
  ],
  [
    "claim",
    "以组员身份接下任务",
    "读清完成条件，写下执行计划，再确认接住。角色切换仅用于教学。",
  ],
  [
    "ai",
    "带着任务背景向 AI 求助",
    "提出具体问题。教学 AI 会结合本任务给出示例建议，并保留这次讨论。",
  ],
  [
    "blocker",
    "报告一次阻塞",
    "说明你卡在哪里、需要什么帮助，让组长能及时协调。",
  ],
  [
    "resource",
    "登记需要的共享资源",
    "为这项任务登记一个资源与用途，避免团队重复占用。",
  ],
  [
    "submit",
    "提交交付证据",
    "附上成果链接或测试说明。提交后进入待验收，不能自己宣布完成。",
  ],
  [
    "review",
    "以导师身份验收成果",
    "检查证据并写下验收意见。这里练习验收通过，实际项目也支持退回修改。",
  ],
  [
    "integration",
    "组长提交阶段集成",
    "任务验收与阶段集成是两道关口。登记集成分支与测试结果。",
  ],
  [
    "approve",
    "导师审核阶段集成",
    "由另一角色确认集成成果，审核通过才开放下一轮。",
  ],
  [
    "iterate",
    "规划下一轮改进",
    "根据本轮反馈补充一个需求，让项目按迭代继续推进。",
  ],
] as const;
export type ExampleState = {
  version: 1;
  phase: number;
  values: Record<string, string>;
  events: { phase: number; title: string; at: string }[];
};
export const EMPTY_EXAMPLE: ExampleState = {
  version: 1,
  phase: 0,
  values: {},
  events: [],
};
export const EXAMPLE_FIELDS: {
  key: string;
  label: string;
  placeholder: string;
  min: number;
}[][] = [
  [{ key: "team", label: "团队名称", placeholder: "校园活动实践小组", min: 2 }],
  [
    {
      key: "project",
      label: "项目名称",
      placeholder: "校园活动报名页",
      min: 2,
    },
  ],
  [
    {
      key: "brief",
      label: "项目目标与完成标准",
      placeholder:
        "制作一个校园活动报名页，可以查看活动、填写报名信息，并验证必填内容。",
      min: 10,
    },
  ],
  [
    {
      key: "task",
      label: "任务标题",
      placeholder: "实现报名表单与必填校验",
      min: 4,
    },
    { key: "assignee", label: "负责人", placeholder: "示例组员：小林", min: 2 },
  ],
  [],
  [
    {
      key: "commitment",
      label: "执行计划",
      placeholder: "先实现姓名与联系方式输入，再补充必填校验。",
      min: 6,
    },
  ],
  [
    {
      key: "question",
      label: "向教学 AI 提问",
      placeholder: "报名表单应该如何处理缺少必填信息的情况？",
      min: 6,
    },
  ],
  [
    {
      key: "blocker",
      label: "卡住的原因与需要的帮助",
      placeholder: "还没有确定报名截止时间，需要组长确认规则。",
      min: 6,
    },
  ],
  [
    {
      key: "resource",
      label: "资源与使用安排",
      placeholder: "设计稿共享文件夹，用于核对报名表单布局。",
      min: 6,
    },
  ],
  [
    {
      key: "evidence",
      label: "成果链接或测试说明",
      placeholder: "姓名为空时显示提示；信息完整时可以提交报名。",
      min: 10,
    },
  ],
  [
    {
      key: "review",
      label: "验收意见",
      placeholder: "必填校验和正常提交流程均通过，符合完成条件。",
      min: 6,
    },
  ],
  [
    {
      key: "integration",
      label: "集成分支与测试结果",
      placeholder: "example/signup-v1；表单校验与报名流程测试通过。",
      min: 10,
    },
  ],
  [
    {
      key: "approval",
      label: "集成审核结论",
      placeholder: "已检查集成结果，可以进入下一轮。",
      min: 6,
    },
  ],
  [
    {
      key: "improvement",
      label: "下一轮新增需求",
      placeholder: "增加报名成功回执，让同学确认报名状态。",
      min: 10,
    },
  ],
];
export function applyExampleStep(
  state: ExampleState,
  phase: number,
  raw: Record<string, string>,
  at: string,
): ExampleState {
  if (!Number.isInteger(phase) || phase < 0 || phase >= EXAMPLE_FLOW.length)
    throw new Error("无效练习步骤");
  if (state.phase > phase) return state;
  if (state.phase !== phase) throw new Error("请先完成上一项操作");
  const values = { ...state.values };
  for (const field of EXAMPLE_FIELDS[phase]) {
    const value =
      typeof raw?.[field.key] === "string" ? raw[field.key].trim() : "";
    if (value.length < field.min || value.length > 2000)
      throw new Error(`${field.label}需填写 ${field.min} 至 2000 个字`);
    values[field.key] = value;
  }
  return {
    version: 1,
    phase: phase + 1,
    values,
    events: [...state.events, { phase, title: EXAMPLE_FLOW[phase][1], at }],
  };
}
