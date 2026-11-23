export const PET_INTERACTIONS = {
  wave: { label: "挥挥手", from: "嗨，工作还顺利吗？", to: "收到！一起加油呀。", icon: "👋" },
  cheer: { label: "加个油", from: "加油，你一定可以的！", to: "谢谢鼓励，我们一起冲！", icon: "✨" },
  coffee: { label: "递杯咖啡", from: "送你一杯咖啡，辛苦啦！", to: "收到咖啡，谢谢伙伴！", icon: "☕" },
  plane: { label: "放飞纸飞机", from: "纸飞机来啦，接住！", to: "接到纸飞机啦，送你一个赞！", icon: "✈️" },
  paper: { label: "丢个小纸团", from: "小纸团来啦，注意躲闪！", to: "嘿，接住了！继续工作吧。", icon: "⚪" },
  tomato: { label: "丢个番茄", from: "快点啊，我等的花都谢了", to: "收到催更，马上加把劲！", icon: "🍅" },
  water: { label: "泼水", from: "搞快点", to: "清醒了，这就加速！", icon: "💦" },
} as const;
export type PetInteractionKind = keyof typeof PET_INTERACTIONS;
export type PetInteractionEvent = { id: string; actorId: string; targetId: string; kind: PetInteractionKind; createdAt: string };
