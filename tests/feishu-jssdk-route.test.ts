import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { resetAllRateLimits } from "@/lib/rate-limit";

const mock = vi.hoisted(() => ({
  ticket: vi.fn(async () => "tk-test"),
  sign: vi.fn(() => "signature-test"),
}));
vi.mock("@/lib/feishu", () => ({ getJsapiTicket: mock.ticket, buildJsapiSignature: mock.sign }));

import { GET } from "@/app/api/feishu/jssdk-config/route";

function request(target: string, base = "http://localhost:3000") {
  return new Request(`${base}/api/feishu/jssdk-config?url=${encodeURIComponent(target)}`);
}

beforeEach(() => { resetAllRateLimits(); mock.ticket.mockClear(); mock.sign.mockClear(); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("飞书 JSSDK 签名接口", () => {
  it("为本站页面签名", async () => {
    const response = await GET(request("http://localhost:3000/login"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ signature: "signature-test" });
  });

  it("拒绝为第三方页面签名", async () => {
    const response = await GET(request("https://evil.example/phish"));
    expect(response.status).toBe(403);
    expect(mock.ticket).not.toHaveBeenCalled();
  });

  it("拒绝非 HTTP(S) 或携带账号的地址", async () => {
    expect((await GET(request("file:///etc/passwd"))).status).toBe(400);
    expect((await GET(request("https://user:pass@localhost:3000/login"))).status).toBe(400);
  });

  it("支持通过 AGILECAMPUS_URL 放行生产域名", async () => {
    vi.stubEnv("AGILECAMPUS_URL", "https://campus.example");
    const response = await GET(request("https://campus.example/login", "http://internal:3000"));
    expect(response.status).toBe(200);
  });

  it("生产环境只认配置来源，不信任伪造的请求 Host", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AGILECAMPUS_URL", "https://campus.example");
    const spoofed = await GET(request("http://evil.example/login", "http://evil.example"));
    expect(spoofed.status).toBe(403);
  });

  it("缺少 url 时返回 400", async () => {
    expect((await GET(new Request("http://localhost:3000/api/feishu/jssdk-config"))).status).toBe(400);
  });

  it("同一 IP 高频请求会被限流", async () => {
    for (let i = 0; i < 60; i++) expect((await GET(request("http://localhost:3000/login"))).status).toBe(200);
    const blocked = await GET(request("http://localhost:3000/login"));
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});
