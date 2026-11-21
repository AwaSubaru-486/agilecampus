import { beforeEach, describe, expect, it, vi } from "vitest";
const authState = vi.hoisted(() => ({ actor: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => authState.actor ? { user: { id: authState.actor } } : null }));
import { db } from "@/db";
import { users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { bindWebPetToHome, ensureHome, setHomeWorking } from "@/lib/home";
import { listPetInteractions, sendPetInteraction } from "@/lib/pets/interactions";
import { GET, POST } from "@/app/api/projects/[projectId]/pet-interactions/route";
import { resetDb } from "./helpers";
async function setup() {
  const [owner, peer, outsider] = await db.insert(users).values([{ email: "actor@pets.test", name: "甲" }, { email: "peer@pets.test", name: "乙" }, { email: "outsider@pets.test", name: "外人" }]).returning();
  const team = await createTeam(owner.id, "互动团队"); await joinTeam(peer.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "互动项目" });
  const otherProject = await createProject(owner.id, team.id, { name: "另一项目" });
  for (const user of [owner, peer]) { await bindWebPetToHome(user.id); await setHomeWorking(user.id, team.id, project.id); }
  return { owner, peer, outsider, project, team, otherProject };
}
beforeEach(async () => { await resetDb(); authState.actor = ""; });
describe("工位桌宠互动", () => {
  it("支持纸飞机和纸团，接收者可以反向投掷", async () => {
    const { owner, peer, project } = await setup();
    const context = { params: Promise.resolve({ projectId: project.id }) };
    authState.actor = owner.id;
    const request = (targetId: string, kind: string) => new Request("http://localhost/api/projects/" + project.id + "/pet-interactions", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ targetId, kind }) });
    expect((await POST(request(peer.id, "plane"), context)).status).toBe(200);
    authState.actor = peer.id;
    expect((await POST(request(owner.id, "paper"), context)).status).toBe(200);
    expect((await listPetInteractions(owner.id, project.id)).map(event => event.kind)).toEqual(["paper", "plane"]);
    expect((await POST(request(owner.id, "invalid-projectile"), context)).status).toBe(400);
  });
  it("双方可看到同一事件，按项目隔离，不改变开工状态", async () => {
    const { owner, peer, project, otherProject } = await setup();
    const event = await sendPetInteraction(owner.id, project.id, peer.id, "coffee");
    expect((await listPetInteractions(peer.id, project.id))[0].id).toBe(event.id);
    expect(await listPetInteractions(peer.id, otherProject.id)).toEqual([]);
    expect((await ensureHome(owner.id)).workingProjectId).toBe(project.id);
    expect((await ensureHome(peer.id)).workingProjectId).toBe(project.id);
  });
  it("并发发送也只允许十秒内一次", async () => {
    const { owner, peer, project } = await setup();
    const results = await Promise.allSettled([sendPetInteraction(owner.id, project.id, peer.id, "wave"), sendPetInteraction(owner.id, project.id, peer.id, "cheer")]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await listPetInteractions(owner.id, project.id)).toHaveLength(1);
  });
  it("拒绝自己、非成员、跨项目及已收工的对象", async () => {
    const { owner, peer, outsider, project, otherProject, team } = await setup();
    await expect(sendPetInteraction(owner.id, project.id, owner.id, "wave")).rejects.toThrow("另一位");
    await expect(sendPetInteraction(owner.id, project.id, outsider.id, "wave")).rejects.toThrow();
    await expect(listPetInteractions(outsider.id, project.id)).rejects.toThrow();
    await setHomeWorking(peer.id, team.id, otherProject.id);
    await expect(sendPetInteraction(owner.id, project.id, peer.id, "wave")).rejects.toThrow("双方");
    await setHomeWorking(peer.id, null);
    await expect(sendPetInteraction(owner.id, project.id, peer.id, "wave")).rejects.toThrow("双方");
  });
  it("API 要求登录和同源，使用真实操作账号并校验互动类型", async () => {
    const { owner, peer, project } = await setup();
    const context = { params: Promise.resolve({ projectId: project.id }) };
    const request = (origin = "http://localhost", kind = "wave") => new Request("http://localhost/api/projects/" + project.id + "/pet-interactions", { method: "POST", headers: { origin }, body: JSON.stringify({ actorId: peer.id, targetId: peer.id, kind }) });
    expect((await GET(request(), context)).status).toBe(401);
    authState.actor = owner.id;
    expect((await POST(request("https://foreign.test"), context)).status).toBe(403);
    expect((await POST(request("http://localhost", "invalid"), context)).status).toBe(400);
    const response = await POST(request(), context); expect(response.status).toBe(200);
    expect((await response.json()).event.actorId).toBe(owner.id);
  });
});
