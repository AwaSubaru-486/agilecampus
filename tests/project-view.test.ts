import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), set: vi.fn(), get: vi.fn(), roster: vi.fn(), revalidate: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: mocks.auth }));
vi.mock("@/lib/project", () => ({ getProjectForUser: mocks.access }));
vi.mock("@/lib/team", () => ({ listTeamMembers: mocks.roster }));
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.set, get: mocks.get }), headers: async () => ({ get: mocks.origin }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { getProjectPerspective, parseProjectView, projectViewMembers, resolveProjectPerspective, type ProjectViewMember } from "@/lib/project-view";
import { setProjectView } from "@/app/(app)/projects/[projectId]/_shared/project-view-actions";

const project = "11111111-1111-4111-8111-111111111111";
const studentA = "22222222-2222-4222-8222-222222222222";
const studentB = "33333333-3333-4333-8333-333333333333";
const teacher = "44444444-4444-4444-8444-444444444444";
const agent = "55555555-5555-4555-8555-555555555555";
const roster: ProjectViewMember[] = [
  { id: "owner", name: "组长", role: "admin", kind: "human" },
  { id: studentA, name: "鱼乐", role: "student", kind: "human" },
  { id: studentB, name: "哈哈哈", role: "student", kind: "human" },
  { id: teacher, name: "郭诗辉", role: "teacher", kind: "human" },
  { id: agent, name: "AI 成员", role: "student", kind: "agent" },
];

describe("具体成员的项目视角", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: "owner" } });
    mocks.access.mockResolvedValue({ role: "admin", project: { teamId: "team" } });
    mocks.roster.mockResolvedValue(roster);
    mocks.get.mockReturnValue(undefined);
    mocks.origin.mockReturnValue("http://127.0.0.1:3106");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("选择同角色的不同组员时保留各自身份和姓名", () => {
    expect(resolveProjectPerspective("admin", "owner", roster, `student:${studentA}`)).toMatchObject({ role: "student", viewUserId: studentA, viewUserName: "鱼乐", preview: true });
    expect(resolveProjectPerspective("admin", "owner", roster, `student:${studentB}`)).toMatchObject({ role: "student", viewUserId: studentB, viewUserName: "哈哈哈", preview: true });
    expect(resolveProjectPerspective("admin", "owner", roster, `teacher:${teacher}`)).toMatchObject({ role: "teacher", viewUserId: teacher, viewUserName: "郭诗辉" });
  });
  it("非组长不能通过伪造 cookie 改变本人视角", () => {
    for (const role of ["student", "teacher"] as const) expect(resolveProjectPerspective(role, "actor", roster, `student:${studentA}`)).toMatchObject({ role, viewUserId: "actor", preview: false });
  });
  it("旧角色值、外组人员、角色错配与 AI 身份回退到组长本人", () => {
    for (const value of ["student", "teacher", `teacher:${studentA}`, `student:${teacher}`, `student:${agent}`, "student:66666666-6666-4666-8666-666666666666"]) {
      expect(resolveProjectPerspective("admin", "owner", roster, value)).toMatchObject({ role: "admin", viewUserId: "owner", preview: false, selection: "admin" });
    }
    expect(projectViewMembers(roster).map(item => item.id).sort()).toEqual([studentA, studentB, teacher].sort());
  });
  it("每次读取使用当前项目的 cookie 和当前小组成员，撤销成员后预览失效", async () => {
    mocks.get.mockReturnValue({ value: `student:${studentA}` });
    expect(await getProjectPerspective("admin", project, "owner", "team")).toMatchObject({ viewUserId: studentA, preview: true });
    expect(mocks.get).toHaveBeenCalledWith(`project-view-${project}`);
    expect(mocks.roster).toHaveBeenCalledWith("team");
    mocks.roster.mockResolvedValue(roster.filter(member => member.id !== studentA));
    expect(await getProjectPerspective("admin", project, "owner", "team")).toMatchObject({ viewUserId: "owner", preview: false });
  });
  it("只保存当前项目的具体人选，保留本机 HTTP 正式模式下可用的 cookie", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await setProjectView(project, `teacher:${teacher}`)).toEqual({ error: null });
    expect(mocks.set).toHaveBeenCalledWith(`project-view-${project}`, `teacher:${teacher}`, expect.objectContaining({ httpOnly: true, sameSite: "lax", secure: false, path: `/projects/${project}` }));
    expect(mocks.revalidate).toHaveBeenCalledWith(`/projects/${project}`, "layout");
  });
  it("HTTPS 保留安全 cookie，并能返回组长本人", async () => {
    mocks.origin.mockReturnValue("https://campus.example");
    expect(await setProjectView(project, "admin")).toEqual({ error: null });
    expect(mocks.set).toHaveBeenCalledWith(`project-view-${project}`, "admin", expect.objectContaining({ secure: true }));
  });
  it("拒绝外组、已移除、角色错配和 AI 人选，不写 cookie", async () => {
    for (const value of [`teacher:${studentA}`, `student:${agent}`, "teacher:66666666-6666-4666-8666-666666666666"]) expect((await setProjectView(project, value)).error).toBeTruthy();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("未登录、组员与非法项目/人选不能保存偏好", async () => {
    mocks.access.mockResolvedValue({ role: "student" });
    expect((await setProjectView(project, `teacher:${teacher}`)).error).toBeTruthy();
    mocks.auth.mockResolvedValue(null);
    expect((await setProjectView(project, "admin")).error).toBeTruthy();
    expect((await setProjectView("bad", "admin")).error).toBeTruthy();
    for (const value of ["student", "teacher", "root", "student:bad", `teacher:${teacher}:extra`]) expect(parseProjectView(value)).toBeNull();
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
