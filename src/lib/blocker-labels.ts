// 阻塞的取值与文案。零依赖叶子模块——
// 悬浮求助入口是客户端组件，而 lib/blocker.ts 引了 db，不能进浏览器包。
// 与 task-status.ts 同一手法：取值定义在这头，db/schema 的 pgEnum 由此派生。

// 原因取值刻意粗而不细：上报时人正焦躁，选项一多他就不填了。
export const BLOCKER_REASONS = ["tech", "resource", "unclear", "time", "dependency", "other"] as const;
export type BlockerReason = (typeof BLOCKER_REASONS)[number];

export const BLOCKER_REASON_LABEL: Record<BlockerReason, string> = {
  tech: "技术难题",
  resource: "缺资源或设备",
  unclear: "需求不清楚",
  time: "时间不够",
  dependency: "在等别人配合",
  other: "其他",
};

/** 悬浮入口的引导语：光问「卡在哪」太空，给个更具体的问法 */
export const BLOCKER_REASON_HINT: Record<BlockerReason, string> = {
  tech: "试过但没跑通、不知道错在哪",
  resource: "需要设备、数据、账号或场地",
  unclear: "不知道要做到什么程度才算完",
  time: "同时压着几件事，排不开",
  dependency: "在等同学交东西或给答复",
  other: "说不清，但就是推不动",
};

export const BLOCKER_STATUSES = ["open", "resolved", "cancelled"] as const;
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

export const BLOCKER_STATUS_LABEL: Record<BlockerStatus, string> = {
  open: "求助中",
  resolved: "已解决",
  cancelled: "已取消",
};
