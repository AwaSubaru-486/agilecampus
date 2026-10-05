// 项目档案的取值与文案。零依赖叶子模块——
// 档案区是客户端组件，而 lib/entry.ts 引了 db，不能进浏览器包。
// 与 task-status.ts、blocker-labels.ts 同一手法：
// 取值定义在这头，db/schema 的 pgEnum 由此派生。

export const ENTRY_TYPES = [
  "feedback", // 老师或组长的反馈
  "doc", // 文档、说明、笔记
  "deliverable", // 成果链接：仓库、演示、数据集、答辩材料
] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const ENTRY_LABEL: Record<EntryType, string> = {
  feedback: "反馈",
  doc: "文档",
  deliverable: "成果",
};

/** 表单里每种类型该问什么。问对问题，人才填得下去。 */
export const ENTRY_PLACEHOLDER: Record<EntryType, { title: string; content: string }> = {
  feedback: {
    title: "这条反馈是关于什么的",
    content: "说清哪里可以更好。学生能看见，且改不了——它是一份记录",
  },
  doc: {
    title: "文档标题",
    content: "写点什么，或者贴一段说明（选填）",
  },
  deliverable: {
    title: "这是什么成果",
    content: "补充说明：这一版做到了什么程度（选填）",
  },
};
