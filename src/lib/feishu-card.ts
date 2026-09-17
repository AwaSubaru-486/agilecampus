// 飞书 interactive 卡片模板。卡片 JSON schema 以飞书官方文档核验字段名。
const SITE = () => process.env.AGILECAMPUS_URL ?? "http://localhost:3000";

// 深链：飞书内点击 → JSSDK 免登 → 项目页 ?task= 自动打开任务弹窗
function taskUrl(projectId: string, taskId: string): string {
  return `${SITE()}/projects/${projectId}?task=${taskId}`;
}

export type CardTask = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  assigneeName: string | null;
  dueDate: string | null;
  priority: string;
  completionNote?: string | null;
};

function field(content: string, isShort = true) {
  return { is_short: isShort, text: { tag: "lark_md", content } };
}

// 只用跳转按钮（url），不做回调按钮：回调须配合飞书事件订阅端点，
// 本项目不做（产品决策见实施方案）。
function detailButton(projectId: string, taskId: string, label = "查看详情") {
  return {
    tag: "action",
    actions: [
      { tag: "button", text: { tag: "plain_text", content: label }, url: taskUrl(projectId, taskId), type: "primary" },
    ],
  };
}

export function buildAssignedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "blue", title: { tag: "plain_text", content: "🎯 新任务指派" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**负责人**\n${t.assigneeName ?? "未分配"}`),
        field(`**截止**\n${t.dueDate ?? "未设"}`),
        field(`**优先级**\n${t.priority}`),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

export function buildCompletedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "green", title: { tag: "plain_text", content: "✅ 任务完成" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**完成情况**\n${t.completionNote ?? "—"}`, false),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

// 待验收：发给组长与教师。紫色与看板上的「待验收」列同色，一眼认得出是同一件事。
export function buildSubmittedCard(t: CardTask) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "purple", title: { tag: "plain_text", content: "📮 待你验收" } },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        field(`**提交人**\n${t.assigneeName ?? "—"}`),
        field(`**交付说明**\n${t.completionNote ?? "—"}`, false),
      ] },
      { tag: "div", text: { tag: "lark_md", content: "通过则任务完成；若需修改，请写明要改什么再退回。" } },
      detailButton(t.projectId, t.id, "去验收"),
    ],
  };
}

// 验收结果：发给提交人。通过为绿、退回为红——颜色即结论，不必读字。
export function buildReviewedCard(
  t: CardTask,
  decision: "accept" | "reject",
  note: string | null,
) {
  const accepted = decision === "accept";
  return {
    config: { wide_screen_mode: true },
    header: {
      template: accepted ? "green" : "red",
      title: { tag: "plain_text", content: accepted ? "✅ 验收通过" : "↩️ 已退回修改" },
    },
    elements: [
      { tag: "div", fields: [
        field(`**任务**\n${t.title}`, false),
        field(`**项目**\n${t.projectName}`),
        ...(note ? [field(`**验收意见**\n${note}`, false)] : []),
      ] },
      detailButton(t.projectId, t.id),
    ],
  };
}

// 项目页深链。阻塞可以不关联任务，故单独有一个不指任务的落点。
export function projectUrl(projectId: string): string {
  return `${SITE()}/projects/${projectId}`;
}

export type BlockerCardInput = {
  projectId: string;
  projectName: string;
  raisedByName: string;
  reasonLabel: string;
  detail: string | null;
  helpNeeded: string | null;
  taskTitle: string | null;
  /** 被点名求助的人；空表示只广播给组长与教师 */
  inviteeNames: string[];
};

// 求助卡片。橙色与「任务提醒」同色系——都是需要有人动手的事，
// 与指派（蓝）、验收（紫）刻意区分开。
export function buildBlockerCard(b: BlockerCardInput) {
  return {
    config: { wide_screen_mode: true },
    header: { template: "orange", title: { tag: "plain_text", content: "🙋 有人卡住了" } },
    elements: [
      { tag: "div", fields: [
        field(`**求助人**\n${b.raisedByName}`),
        field(`**项目**\n${b.projectName}`),
        field(`**卡在**\n${b.reasonLabel}`),
        ...(b.taskTitle ? [field(`**关联任务**\n${b.taskTitle}`)] : []),
        ...(b.helpNeeded ? [field(`**需要什么**\n${b.helpNeeded}`, false)] : []),
        ...(b.detail ? [field(`**补充说明**\n${b.detail}`, false)] : []),
      ] },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content:
            b.inviteeNames.length > 0
              ? `点名请 ${b.inviteeNames.join("、")} 看一眼。帮上忙后，请到项目页把这条求助标记为已解决。`
              : "请组长或教师看一眼，必要时转给能帮忙的同学。",
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "去看一眼" },
            url: projectUrl(b.projectId),
            type: "primary",
          },
        ],
      },
    ],
  };
}

export type ReminderItem = { id: string; title: string; projectId: string };

export function buildDueReminderCard(input: { overdue: ReminderItem[]; dueSoon: ReminderItem[] }) {
  const line = (i: ReminderItem) => `- [${i.title}](${taskUrl(i.projectId, i.id)})`;
  const elements: unknown[] = [];
  if (input.overdue.length) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**逾期未完成**\n${input.overdue.map(line).join("\n")}` } });
  }
  if (input.dueSoon.length) {
    elements.push({ tag: "div", text: { tag: "lark_md", content: `**即将到期**\n${input.dueSoon.map(line).join("\n")}` } });
  }
  return {
    config: { wide_screen_mode: true },
    header: { template: "orange", title: { tag: "plain_text", content: "⏰ 任务提醒" } },
    elements,
  };
}
