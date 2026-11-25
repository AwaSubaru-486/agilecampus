import { describe, expect, it } from "vitest";
import { constrainTutorialCard } from "@/app/(app)/tutorials/use-tutorial-card-drag";

describe("教程悬浮框位置", () => {
  const card = { width: 392, height: 300 };
  const desktop = { width: 1280, height: 720 };

  it("保留视窗内手动移动的位置", () => {
    expect(constrainTutorialCard({ left: 420, top: 150 }, card, desktop)).toEqual({ left: 420, top: 150 });
  });

  it("拖到屏幕外时将卡片留在可操作范围内", () => {
    expect(constrainTutorialCard({ left: -400, top: 900 }, card, desktop)).toEqual({ left: 8, top: 412 });
    expect(constrainTutorialCard({ left: 2000, top: -300 }, card, desktop)).toEqual({ left: 880, top: 8 });
  });

  it("切换到窄屏或切换步骤后按实际大小重新限制位置", () => {
    const saved = { left: 880, top: 412 };
    const mobile = { width: 390, height: 700 };
    expect(constrainTutorialCard(saved, { width: 366, height: 300 }, mobile)).toEqual({ left: 16, top: 392 });
    expect(constrainTutorialCard(saved, { width: 366, height: 380 }, mobile)).toEqual({ left: 16, top: 312 });
  });
});
