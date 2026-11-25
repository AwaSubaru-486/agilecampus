import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ actor: "" }));
vi.mock("@/lib/auth", () => ({ auth: async () => session.actor ? { user: { id: session.actor } } : null }));
import { readFile, rm } from "node:fs/promises";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject } from "@/lib/project";
import { ensureHome, getHomeView, setHomeWorking } from "@/lib/home";
import { webPetRuntime } from "@/lib/pets/web-pet-security";
import { readWebPetConfig, webPetId } from "@/lib/pets/web-pet-config";
import { currentWebHomePet } from "@/lib/pets/web-home-pet";
import { readDesktopAsset } from "@/lib/pets/desktop-asset";
import { authenticateDesktop, consumeDesktopPairing, createDesktopPairing, desktopState } from "@/lib/pets/desktop-session";
import { POST as control } from "@/app/api/desktop-pet/control/route";
import { GET as image } from "@/app/api/pets/web/[ownerId]/[assetKey]/route";
import { resetDb } from "./helpers";

const owners: string[] = [];
async function setup() {
  const result = await db.insert(users).values([{ email: "web-owner@test.local", name: "主人" }, { email: "web-peer@test.local", name: "队友" }, { email: "web-stranger@test.local", name: "外人" }]).returning();
  owners.push(...result.map(user => user.id));
  const [owner, peer, stranger] = result;
  const team = await createTeam(owner.id, "联动测试"); await joinTeam(peer.id, team.inviteCode);
  const project = await createProject(owner.id, team.id, { name: "办公室" }); session.actor = owner.id;
  return { owner, peer, stranger, team, project };
}
function configure(config: unknown) {
  return control(new Request("http://localhost/api/desktop-pet/control", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ action: "update-config", config }) }));
}
async function asset(ownerId: string, key?: string) {
  const pet = await currentWebHomePet(ownerId);
  return image(new Request("http://localhost" + pet.appearance.src), { params: Promise.resolve({ ownerId, assetKey: key ?? pet.appearance.src.split("/").at(-1)! }) });
}
beforeEach(async () => { await resetDb(); });
afterEach(async () => { for (const owner of owners.splice(0)) await rm(webPetRuntime(owner), { recursive: true, force: true }); session.actor = ""; });

describe("网页桌宠与办公室联动", () => {
  it("桌面连接直接跟随网页配置，换装后资源和状态使用相同版本", async () => {
    const { owner } = await setup();
    const invite = await createDesktopPairing(owner.id, "http://127.0.0.1:3106");
    const ticket = new URL(invite.launchUrl).searchParams.get("ticket")!;
    const { token } = await consumeDesktopPairing(ticket);
    const record = await authenticateDesktop(new Request("http://127.0.0.1:3106/api/home/desktop/state", {
      headers: { authorization: `Bearer ${token}` },
    }));

    expect((await ensureHome(owner.id)).pet.petId).toBeNull();
    const before = await desktopState(record);
    expect(before).toMatchObject({ status: "ready", pet: { id: webPetId(owner.id), name: "线条小狗" } });
    expect((await readDesktopAsset(owner.id)).version).toBe(before.assetVersion);

    expect((await configure({ preset: "mentor", name: "西装伙伴" })).status).toBe(200);
    const after = await desktopState(record);
    const picture = await readDesktopAsset(owner.id);
    expect(after.pet).toMatchObject({ id: webPetId(owner.id), name: "西装伙伴" });
    expect(after.assetVersion).not.toBe(before.assetVersion);
    expect(picture.version).toBe(after.assetVersion);
    expect(Buffer.from(picture.bytes)).toEqual(await readFile("public/desk-pet/frames/mentor_0.png"));
  });

  it("换装、改名绑定同一个桌宠，开工状态保留，图像版本变化", async () => {
    const { owner, peer, team, project } = await setup();
    expect((await configure({ preset: "puppy", name: "小白" })).status).toBe(200);
    expect((await ensureHome(owner.id)).pet.petId).toBe(webPetId(owner.id));
    expect(await readDesktopAsset(owner.id)).toMatchObject({ mimeType: "image/png", petId: webPetId(owner.id) });
    await setHomeWorking(owner.id, team.id, project.id);
    const first = await currentWebHomePet(owner.id);
    if (first.appearance.type !== "image") throw new Error("expected image");
    const greetingKey = first.appearance.greetSrc!.split("/").at(-1)!;
    expect(greetingKey).toMatch(/-greet$/);
    expect(Buffer.from(await (await asset(owner.id, greetingKey)).arrayBuffer())).toEqual(await readFile("public/desk-pet/frames/puppy_3.png"));
    expect((await configure({ preset: "pacman", name: "豆豆" })).status).toBe(200);
    const home = await ensureHome(owner.id); expect(home.workingProjectId).toBe(project.id);
    const view = await getHomeView(peer.id, { view: "courtyard", team: team.id, projectId: project.id });
    expect(view.workstations.find(seat => seat.ownerId === owner.id)?.pet?.name).toBe("豆豆");
    expect((await currentWebHomePet(owner.id)).appearance.src).not.toBe(first.appearance.src);
    expect((await configure({ preset: "mentor", name: "西装伙伴" })).status).toBe(200);
    const mentorPet = await currentWebHomePet(owner.id);
    if (mentorPet.appearance.type !== "image") throw new Error("expected image");
    expect(Buffer.from(await (await asset(owner.id)).arrayBuffer())).toEqual(await readFile("public/desk-pet/frames/mentor_0.png"));
    expect(Buffer.from(await (await asset(owner.id, mentorPet.appearance.greetSrc!.split("/").at(-1)!)).arrayBuffer())).toEqual(await readFile("public/desk-pet/frames/mentor_3.png"));
  });
  it("图片只对本人或开工项目成员开放，收工后撤销，旧图片版本不再可读", async () => {
    const { owner, peer, stranger, team, project } = await setup(); await configure({ preset: "puppy", name: "小白" });
    expect((await asset(owner.id)).status).toBe(200);
    session.actor = peer.id; expect((await asset(owner.id)).status).toBe(403);
    const pet = await currentWebHomePet(owner.id);
    if (pet.appearance.type !== "image") throw new Error("expected image");
    expect((await asset(owner.id, pet.appearance.greetSrc!.split("/").at(-1)!)).status).toBe(403);
    await setHomeWorking(owner.id, team.id, project.id); expect((await asset(owner.id)).status).toBe(200);
    session.actor = stranger.id; expect((await asset(owner.id)).status).toBe(403);
    await setHomeWorking(owner.id, null); session.actor = peer.id; expect((await asset(owner.id)).status).toBe(403);
    session.actor = owner.id; expect((await asset(owner.id, "a".repeat(24))).status).toBe(404);
    session.actor = ""; expect((await asset(owner.id)).status).toBe(401);
  });
  it("自定义上传支持超过旧 32KB 限制，拒绝本机路径和任意协议，不改其他账号", async () => {
    const { owner, peer } = await setup();
    const bytes = await readFile("public/pets/demo/qing-bot.png");
    const data = `data:image/png;base64,${bytes.toString("base64")}`;
    expect((await configure({ preset: "custom", name: "自定义", customImageUrl: data })).status).toBe(200);
    expect(Buffer.from(await (await asset(owner.id)).arrayBuffer())).toEqual(bytes);
    expect(Buffer.from((await readDesktopAsset(owner.id)).bytes)).toEqual(bytes);
    expect((await readWebPetConfig(peer.id)).preset).toBe("puppy");
    for (const src of ["file:///secret", "C:\\secret.png", "../package.json", "javascript:alert(1)"]) {
      expect((await configure({ preset: "custom", customImageUrl: src })).status).toBe(400);
    }
    expect((await readWebPetConfig(owner.id)).customImageUrl).toBe(data);
  });
});
