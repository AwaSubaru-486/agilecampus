import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAllRateLimits } from "@/lib/rate-limit";

const mock = vi.hoisted(() => ({
  auth: vi.fn(),
  advise: vi.fn(),
  health: vi.fn(),
  narrate: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ auth: mock.auth }));
vi.mock("@/lib/draft-planning-ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/draft-planning-ai")>();
  return { ...actual, adviseDraftPlanning: mock.advise };
});
vi.mock("@/lib/health", () => ({ getProjectHealth: mock.health }));
vi.mock("@/lib/agent/health-narrator", () => ({ narrateHealth: mock.narrate }));

import { POST as draftPOST } from "@/app/api/draft-planning/route";
import { POST as healthPOST } from "@/app/api/projects/[projectId]/health-narrative/route";

const projectId = "00000000-0000-4000-8000-000000000001";
const base = "http://localhost:3000";
const headers = { origin: base, host: "localhost:3000", "content-type": "application/json" };

function draftRequest(body = JSON.stringify({ mode: "timeline", projectId })) {
  return new Request(`${base}/api/draft-planning`, { method: "POST", headers, body });
}
function healthRequest() {
  return healthPOST(new Request(`${base}/api/projects/${projectId}/health-narrative`, { method: "POST" }), { params: Promise.resolve({ projectId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetAllRateLimits();
  mock.auth.mockResolvedValue({ user: { id: "actor" } });
  mock.advise.mockResolvedValue({ plan: [] });
  mock.health.mockResolvedValue({ issues: [] });
  mock.narrate.mockResolvedValue("ok");
});

describe("AI 路由的限流与请求体上限", () => {
  it("草案分析超过每分钟次数后被限流", async () => {
    for (let i = 0; i < 20; i++) expect((await draftPOST(draftRequest())).status).toBe(200);
    const blocked = await draftPOST(draftRequest());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
    expect(mock.advise).toHaveBeenCalledTimes(20);
  });

  it("草案请求体过大时不进入模型", async () => {
    const response = await draftPOST(draftRequest(JSON.stringify({ mode: "timeline", projectId, padding: "x".repeat(300 * 1024) })));
    expect(response.status).toBe(413);
    expect(mock.advise).not.toHaveBeenCalled();
  });

  it("草案接口仍校验同源来源", async () => {
    const response = await draftPOST(new Request(`${base}/api/draft-planning`, {
      method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: JSON.stringify({ mode: "timeline", projectId }),
    }));
    expect(response.status).toBe(403);
  });

  it("健康度综述独立限流，不会无限消耗模型费用", async () => {
    for (let i = 0; i < 10; i++) expect((await healthRequest()).status).toBe(200);
    const blocked = await healthRequest();
    expect(blocked.status).toBe(429);
    expect(mock.narrate).toHaveBeenCalledTimes(10);
  });
});
