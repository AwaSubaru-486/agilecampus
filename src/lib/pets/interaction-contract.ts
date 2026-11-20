export const PET_INTERACTIONS = {
  wave: { label: "挥挥手", from: "嗨，工作还顺利吗？", to: "收到！一起加油呀。", icon: "👋" },
  cheer: { label: "加个油", from: "加油，你一定可以的！", to: "谢谢鼓励，我们一起冲！", icon: "✨" },
  coffee: { label: "递杯咖啡", from: "送你一杯咖啡，辛苦啦！", to: "收到咖啡，谢谢伙伴！", icon: "☕" },
} as const;
export type PetInteractionKind = keyof typeof PET_INTERACTIONS;
export type PetInteractionEvent = { id: string; actorId: string; targetId: string; kind: PetInteractionKind; createdAt: string };
