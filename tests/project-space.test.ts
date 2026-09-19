import { describe, it, expect } from "vitest";
import {
  DEFAULT_SPACE,
  PROJECT_SPACES,
  SPACE_HINT,
  SPACE_LABEL,
  buildSpaceHref,
  parseProjectSpace,
  spaceForConversationParams,
} from "@/lib/project-space";

const PID = "11111111-1111-1111-1111-111111111111";

describe("parseProjectSpace", () => {
  it("四个合法值都认得", () => {
    for (const s of PROJECT_SPACES) expect(parseProjectSpace(s)).toBe(s);
  });

  // URL 是用户能改的地方，也可能被别的系统拼错。
  // 非法值退回默认，不抛错——不该因为一个错参数就 500
  it("非法值退回默认，不抛错", () => {
    expect(parseProjectSpace("galaxy")).toBe(DEFAULT_SPACE);
    expect(parseProjectSpace("")).toBe(DEFAULT_SPACE);
    expect(parseProjectSpace("LIVE")).toBe(DEFAULT_SPACE); // 大小写敏感，不猜
  });

  it("缺省与 undefined 退回默认", () => {
    expect(parseProjectSpace(undefined)).toBe(DEFAULT_SPACE);
    expect(parseProjectSpace(null)).toBe(DEFAULT_SPACE);
  });

  it("同名参数出现多次时取第一个", () => {
    expect(parseProjectSpace(["work", "studio"])).toBe("work");
    expect(parseProjectSpace(["galaxy", "record"])).toBe(DEFAULT_SPACE); // 第一个非法就回落
  });

  it("非字符串一律退回默认", () => {
    expect(parseProjectSpace(42)).toBe(DEFAULT_SPACE);
    expect(parseProjectSpace({ space: "work" })).toBe(DEFAULT_SPACE);
    expect(parseProjectSpace([])).toBe(DEFAULT_SPACE);
  });

  it("默认模式是 live", () => {
    expect(DEFAULT_SPACE).toBe("live");
  });

  it("每个模式都有中文名与一句话说明", () => {
    for (const s of PROJECT_SPACES) {
      expect(SPACE_LABEL[s]).toBeTruthy();
      expect(SPACE_HINT[s]).toBeTruthy();
    }
  });
});

describe("buildSpaceHref", () => {
  // space 显式写进 URL（含默认的 live）：四模式并列平权，
  // 让「现场」独享省略形式会让人以为它是主页面
  it("默认模式也显式写进 URL", () => {
    expect(buildSpaceHref({ projectId: PID, space: "live" })).toBe(
      `/projects/${PID}?space=live`,
    );
  });

  it("带 task 时一并带上", () => {
    const href = buildSpaceHref({ projectId: PID, space: "work", taskId: "t-1" });
    expect(href).toContain("space=work");
    expect(href).toContain("task=t-1");
  });

  it("不带 task 时不出现空参数", () => {
    const href = buildSpaceHref({ projectId: PID, space: "record" });
    expect(href).not.toContain("task=");
    expect(href).not.toContain("undefined");
  });

  it("带 conversation 时一并带上", () => {
    const href = buildSpaceHref({ projectId: PID, space: "studio", conversationId: "c-1" });
    expect(href).toContain("conversation=c-1");
  });

  it("拼出来的链接能被 parseProjectSpace 解回来（往返一致）", () => {
    for (const s of PROJECT_SPACES) {
      const href = buildSpaceHref({ projectId: PID, space: s });
      const parsed = new URL(href, "http://x").searchParams.get("space");
      expect(parseProjectSpace(parsed)).toBe(s);
    }
  });
});

describe("会话参数与模式的关系", () => {
  // 带着会话 ID 落到别的模式时应当跳过去，而不是静默忽略——
  // 静默忽略会让「点了一条会话链接却停在现场」变成一桩悬案
  it("带 conversation 时一律落到协同室", () => {
    expect(spaceForConversationParams("live", true)).toBe("studio");
    expect(spaceForConversationParams("record", true)).toBe("studio");
  });

  it("不带 conversation 时保持原模式", () => {
    expect(spaceForConversationParams("work", false)).toBe("work");
  });
});
