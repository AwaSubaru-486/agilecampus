import { generateText, type LanguageModel } from "ai";
import { getModel } from "./model";
import type { HealthIssue } from "@/lib/health";

// 健康度叙事：把确定性规则算出的一串条目，译成一段人话。
//
// 边界靠结构强制，不靠 prompt 自觉：
//   1. 输入只有 evaluateProjectHealth 产出的 HealthIssue[]，不给模型看任务全量。
//      它没有编造新风险的素材——想编也无从编起。
//   2. prompt 明令不得新增、不得推断未列出的问题。
//   3. 界面上的数字、任务名、「谁来做」全部由代码渲染；模型的话只落进
//      卡片里一个正文槽位。它即便胡说，也说坏一段话，改不了一个数、换不掉一个人名。
//
// 这三条合起来，比「让 AI 生成整页健康报告」安全一个量级。

const PREAMBLE = `你在帮一个高校项目团队读「项目健康度」面板。

面板上的每一条风险都已由确定性规则算出，附有：为什么红、该做什么、谁来做。

你的唯一任务：把这些条目串成一段给组长看的综述，说清「眼下最要紧的是哪几件、先动哪一件、为什么」。

铁律：
- 只解释给你的条目。不得新增、不得推断、不得猜测未列出的问题。
- 不得改动任何数字、任务名与人名。它们必须与你收到的完全一致。
- 不得提出面板之外的建议（如「建议引入 CI」「建议加强沟通」一类泛泛之谈）。
- 若条目为空，只说团队当前没有需要干预的风险。
- 用中文，三到五句话，直接说事，不要复述数据结构。`;

export type NarrateHealthOptions = {
  /** 测试注入 mock；生产不传，走 getModel() */
  model?: LanguageModel;
};

export async function narrateHealth(
  issues: HealthIssue[],
  projectName: string,
  opts?: NarrateHealthOptions,
): Promise<string> {
  const payload = issues.map((i) => ({
    signal: i.signal,
    severity: i.severity,
    为什么红: i.whyRed,
    该做什么: i.action,
    谁来做: i.ownerName ?? "尚未定人",
    依据: i.evidence,
  }));

  const { text } = await generateText({
    model: opts?.model ?? getModel(),
    system: PREAMBLE,
    prompt: `项目：${projectName}\n\n健康度条目（JSON）：\n${JSON.stringify(payload, null, 2)}`,
    // 叙事不调工具，且与对话同口径：失败即如实呈报，不自动重试
    maxRetries: 0,
  });

  return text.trim();
}
