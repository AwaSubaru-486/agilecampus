import { afterEach, describe, expect, it, vi } from "vitest";
import { assertSafeModelBaseUrl, guardedModelFetch, isBlockedAddress, modelBaseUrlIssue } from "@/lib/url-safety";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("模型地址安全边界", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
    "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "198.18.0.1", "203.0.113.5",
    "::1", "::", "fc00::1", "fd12::1", "fe80::1", "ff02::1", "::ffff:127.0.0.1",
    "::ffff:7f00:1", "::7f00:1", "64:ff9b::7f00:1", "2001:db8::1",
  ])("拒绝内网或保留地址 %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])("放行公网地址 %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it.each([
    "http://127.0.0.1:8000/v1", "http://localhost/v1", "http://[::1]/v1",
    "http://[::ffff:127.0.0.1]/v1", "http://[::ffff:10.0.0.1]/v1", "http://[64:ff9b::7f00:1]/v1",
    "http://2130706433/v1", "http://0x7f000001/v1", "http://127.1/v1",
    "http://169.254.169.254/latest", "http://metadata.internal/v1", "http://ollama/v1",
    "http://10.0.0.2:11434/v1", "file:///etc/passwd", "https://user:pass@example.com/v1",
    "https://example.com/v1?key=secret", "https://example.com/v1#fragment",
  ])("保存配置时拒绝不安全的地址 %s", (value) => {
    expect(modelBaseUrlIssue(value)).not.toBeNull();
  });

  it("放行普通公网 HTTPS 地址", () => {
    expect(modelBaseUrlIssue("https://api.deepseek.com/v1")).toBeNull();
    expect(modelBaseUrlIssue("https://example.com/v1/")).toBeNull();
  });

  it("assertSafeModelBaseUrl 直接抛出可展示错误", () => {
    expect(() => assertSafeModelBaseUrl("http://127.0.0.1/v1")).toThrow("内网");
  });

  it("显式允许内网时才放行本机地址", () => {
    vi.stubEnv("MODEL_ALLOW_PRIVATE_NETWORK", "1");
    expect(modelBaseUrlIssue("http://localhost:11434/v1")).toBeNull();
  });

  it("请求前拦截内网目标，且不调用真实 fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(guardedModelFetch("http://127.0.0.1:9999/v1/chat/completions", { method: "POST" })).rejects.toThrow("内网");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
