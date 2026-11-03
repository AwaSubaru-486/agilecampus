import { describe, expect, it, vi } from "vitest";
import { launchDesktopClient } from "@/lib/pets/launch-desktop-client";
describe("网页直接唤起桌宠", () => {
  it("创建链接后实际点击并清理，不能只生成邀请", () => {
    const link = { href: "", style: { display: "" }, click: vi.fn(), remove: vi.fn() };
    const document = { createElement: vi.fn(() => link), body: { appendChild: vi.fn() } };
    const href = "agilecampus-pet://connect?server=http%3A%2F%2F127.0.0.1%3A3000&ticket=test";
    launchDesktopClient(href, document as unknown as Document);
    expect(link.href).toBe(href);
    expect(link.click).toHaveBeenCalledOnce();
    expect(link.remove).toHaveBeenCalledOnce();
  });
  it("不会打开外部网站、脚本或未知原生操作", () => {
    const document = { createElement: vi.fn() };
    for (const href of ["https://untrusted.test", "javascript:alert(1)", "file:///secret", "agilecampus-pet://execute?command=anything"])
      expect(() => launchDesktopClient(href, document as unknown as Document)).toThrow("唤起地址");
    expect(document.createElement).not.toHaveBeenCalled();
  });
});
