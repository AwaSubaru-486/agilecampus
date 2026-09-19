import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam, updateMemberRole } from "@/lib/team";
import { createProject } from "@/lib/project";
import { createTask } from "@/lib/task";
import { createAgent } from "@/lib/agent-member";
import {
  countEntries,
  createEntry,
  deleteEntry,
  listProjectEntries,
  updateEntry,
} from "@/lib/entry";
import { listProjectActivity } from "@/lib/activity-feed";
import { resetDb } from "./helpers";

async function makeUser(email: string) {
  return createUser({ email, password: "password123", name: email.split("@")[0] });
}

async function scene() {
  const owner = await makeUser("owner@example.com");
  const team = await createTeam(owner.id, "东吴实验室");
  const student = await makeUser("student@example.com");
  await joinTeam(student.id, team.inviteCode);
  const teacher = await makeUser("teacher@example.com");
  await joinTeam(teacher.id, team.inviteCode);
  await updateMemberRole(owner.id, team.id, teacher.id, "teacher");
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, teacher, outsider, project };
}

describe("老师反馈", () => {
  beforeEach(resetDb);

  it("老师可留，学生看得到，作者身份标着 teacher", async () => {
    const { owner, teacher, project } = await scene();
    await createEntry(teacher.id, project.id, {
      type: "feedback",
      title: "中期报告的意见",
      content: "实验部分需要补一组对照组",
    });

    const list = await listProjectEntries(owner.id, project.id);
    expect(list).toHaveLength(1);
    expect(list[0].authorRole).toBe("teacher");
    expect(list[0].content).toContain("对照组");
  });

  it("组长也可以留", async () => {
    const { owner, project } = await scene();
    const e = await createEntry(owner.id, project.id, { type: "feedback", title: "节奏慢了" });
    expect(e.type).toBe("feedback");
  });

  // 学生若也有这个入口，「老师反馈」四个字就不再意味着什么
  it("学生留不了反馈", async () => {
    const { student, project } = await scene();
    await expect(
      createEntry(student.id, project.id, { type: "feedback", title: "我觉得" }),
    ).rejects.toThrow("只有老师或组长");
  });

  it("非成员留不了任何档案", async () => {
    const { outsider, project } = await scene();
    await expect(
      createEntry(outsider.id, project.id, { type: "doc", title: "插一脚" }),
    ).rejects.toThrow("没有权限");
  });
});

describe("文档与成果链接", () => {
  beforeEach(resetDb);

  it("学生也可以添文档", async () => {
    const { student, project } = await scene();
    await createEntry(student.id, project.id, {
      type: "doc",
      title: "环境搭建说明",
      content: "装 node 22，然后 npm i",
    });
    const list = await listProjectEntries(student.id, project.id, { types: ["doc"] });
    expect(list[0].title).toBe("环境搭建说明");
  });

  it("成果必须附链接", async () => {
    const { owner, project } = await scene();
    await expect(
      createEntry(owner.id, project.id, { type: "deliverable", title: "代码仓库" }),
    ).rejects.toThrow("要附一个链接");
  });

  it("链接格式不对要拦", async () => {
    const { owner, project } = await scene();
    await expect(
      createEntry(owner.id, project.id, {
        type: "deliverable",
        title: "代码仓库",
        url: "github.com/foo/bar",
      }),
    ).rejects.toThrow("http");
  });

  it("链接正常时存下来", async () => {
    const { owner, project } = await scene();
    const e = await createEntry(owner.id, project.id, {
      type: "deliverable",
      title: "代码仓库",
      url: "https://github.com/foo/bar",
    });
    expect(e.url).toBe("https://github.com/foo/bar");
  });
});

describe("挂在任务上", () => {
  beforeEach(resetDb);

  it("反馈可以针对某件任务，读出任务标题", async () => {
    const { owner, teacher, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "撰写中期报告" });
    await createEntry(teacher.id, project.id, {
      type: "feedback",
      title: "这份报告的问题",
      taskId: t.id,
    });

    const [row] = await listProjectEntries(owner.id, project.id);
    expect(row.taskId).toBe(t.id);
    expect(row.taskTitle).toBe("撰写中期报告");
  });

  it("挂到别的项目的任务上被拒", async () => {
    const { owner, team, project } = await scene();
    const other = await createProject(owner.id, team.id, { name: "另一个" });
    const t = await createTask(owner.id, other.id, { title: "别处的" });
    await expect(
      createEntry(owner.id, project.id, { type: "doc", title: "x", taskId: t.id }),
    ).rejects.toThrow("任务不属于该项目");
  });
});

describe("谁能改、谁能删", () => {
  beforeEach(resetDb);

  it("作者本人可改", async () => {
    const { student, project } = await scene();
    const e = await createEntry(student.id, project.id, { type: "doc", title: "草稿" });
    const u = await updateEntry(student.id, e.id, { title: "定稿" });
    expect(u.title).toBe("定稿");
  });

  // 老师留的反馈学生改不了——能改别人的反馈，反馈就不再可信
  it("学生改不了老师留的反馈", async () => {
    const { teacher, student, project } = await scene();
    const e = await createEntry(teacher.id, project.id, { type: "feedback", title: "意见" });
    await expect(updateEntry(student.id, e.id, { content: "改成我喜欢的样子" })).rejects.toThrow(
      "没有权限",
    );
  });

  it("组长可以删任何一条", async () => {
    const { owner, student, project } = await scene();
    const e = await createEntry(student.id, project.id, { type: "doc", title: "x" });
    await deleteEntry(owner.id, e.id);
    expect(await listProjectEntries(owner.id, project.id)).toHaveLength(0);
  });

  it("学生删不了别人的", async () => {
    const { owner, student, project } = await scene();
    const e = await createEntry(owner.id, project.id, { type: "doc", title: "x" });
    await expect(deleteEntry(student.id, e.id)).rejects.toThrow("没有权限");
  });
});

describe("与活动流打通", () => {
  beforeEach(resetDb);

  it("留反馈记一笔事件，摘要里有人话", async () => {
    const { owner, teacher, project } = await scene();
    await createEntry(teacher.id, project.id, { type: "feedback", title: "实验部分太薄" });

    const feed = await listProjectActivity(owner.id, project.id);
    const e = feed.find((x) => x.type === "entry_created");
    expect(e?.summary).toBe("留下反馈「实验部分太薄」");
    expect(e?.actorName).toBe("teacher");
  });

  it("删除也记一笔", async () => {
    const { owner, project } = await scene();
    const e = await createEntry(owner.id, project.id, { type: "doc", title: "x" });
    await deleteEntry(owner.id, e.id);
    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed.some((x) => x.type === "entry_deleted")).toBe(true);
  });
});

describe("档案概览", () => {
  beforeEach(resetDb);

  it("按类型分别计数，空类型也是 0 而不是缺键", async () => {
    const { owner, teacher, project } = await scene();
    await createEntry(teacher.id, project.id, { type: "feedback", title: "a" });
    await createEntry(owner.id, project.id, { type: "doc", title: "b" });
    await createEntry(owner.id, project.id, {
      type: "deliverable",
      title: "c",
      url: "https://x.com",
    });

    const counts = await countEntries(project.id);
    expect(counts).toEqual({ feedback: 1, doc: 1, deliverable: 1 });
  });

  it("一条都没有时也返回完整的三个键", async () => {
    const { project } = await scene();
    expect(await countEntries(project.id)).toEqual({ feedback: 0, doc: 0, deliverable: 0 });
  });
});

describe("agent 也能留下成果", () => {
  beforeEach(resetDb);

  it("AI 交付的链接进得了档案", async () => {
    const { owner, team, project } = await scene();
    const agent = await createAgent(owner.id, team.id, { name: "小码", provider: "claude-code" });
    await createEntry(agent.userId, project.id, {
      type: "deliverable",
      title: "实现问答接口",
      url: "https://github.com/foo/bar/pull/12",
    });

    const [row] = await listProjectEntries(owner.id, project.id);
    expect(row.authorKind).toBe("agent");
    expect(row.authorRole).toBe("student"); // 与它入席时的角色一致
  });
});
