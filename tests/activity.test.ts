import { describe, it, expect, beforeEach } from "vitest";
import { createUser } from "@/lib/user";
import { createTeam, joinTeam } from "@/lib/team";
import { createProject, createMilestone } from "@/lib/project";
import { createTask, updateTask, deleteTask, setTaskSuccessors } from "@/lib/task";
import { createLabel, setTaskLabels } from "@/lib/label";
import { commitDraft } from "@/lib/agent/commit";
import { describe as phrase, recordEvent } from "@/lib/activity";
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
  const outsider = await makeUser("outsider@example.com");
  const project = await createProject(owner.id, team.id, { name: "赤壁演习" });
  return { owner, team, student, outsider, project };
}

describe("describe 措辞（纯函数）", () => {
  it("状态变更译成中文档位名而非字面量", () => {
    expect(phrase.taskStatusChanged("调研", "todo", "doing")).toBe("将「调研」由待办改为进行中");
  });

  it("取消指派与改派措辞不同", () => {
    expect(phrase.taskAssigned("调研", "张三")).toBe("将「调研」指派给 张三");
    expect(phrase.taskAssigned("调研", null)).toBe("取消了「调研」的指派");
  });

  it("后置任务清空与设置措辞不同", () => {
    expect(phrase.taskDependencyChanged("调研", 0)).toBe("清空了「调研」的后置任务");
    expect(phrase.taskDependencyChanged("调研", 2)).toBe("为「调研」设置了 2 个后置任务");
  });
});

describe("活动流埋点", () => {
  beforeEach(resetDb);

  it("建任务记一笔 task_created，摘要含标题", async () => {
    const { owner, project } = await scene();
    await createTask(owner.id, project.id, { title: "撰写调研问卷" });

    const feed = await listProjectActivity(owner.id, project.id);
    // project_created 亦在流中，故取最近一条任务类事件
    const created = feed.find((e) => e.type === "task_created");
    expect(created?.summary).toBe("创建了任务「撰写调研问卷」");
    expect(created?.actorName).toBe("owner");
  });

  it("改状态记 task_status_changed 并冻结前后档位", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await updateTask(owner.id, t.id, { status: "doing" });

    const [latest] = await listProjectActivity(owner.id, project.id);
    expect(latest.type).toBe("task_status_changed");
    expect(latest.payload).toMatchObject({ from: "todo", to: "doing" });
  });

  it("改派记 task_assigned 且不叠一笔笼统的 task_updated", async () => {
    const { owner, student, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await updateTask(owner.id, t.id, { assigneeId: student.id });

    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed[0].type).toBe("task_assigned");
    expect(feed[0].summary).toContain("student");
    expect(feed.filter((e) => e.type === "task_updated")).toHaveLength(0);
  });

  it("状态未变时改标题记 task_updated", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await updateTask(owner.id, t.id, { title: "甲（改）" });

    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed[0].type).toBe("task_updated");
    expect(feed[0].summary).toBe("修改了「甲（改）」");
  });

  it("贴标签记 task_labeled，摘要冻结标签名", async () => {
    const { owner, team, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    const l = await createLabel(owner.id, team.id, { name: "要紧", color: "red" });
    await setTaskLabels(owner.id, t.id, [l.id]);

    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed[0].type).toBe("task_labeled");
    expect(feed[0].summary).toBe("为「甲」贴上标签：要紧");

    // 标签改名后，历史措辞不该跟着变
    expect(feed[0].payload).toMatchObject({ labelNames: ["要紧"] });
  });

  it("设后置任务记 task_dependency_changed", async () => {
    const { owner, project } = await scene();
    const a = await createTask(owner.id, project.id, { title: "甲" });
    const b = await createTask(owner.id, project.id, { title: "乙" });
    await setTaskSuccessors(owner.id, a.id, [b.id]);

    const [latest] = await listProjectActivity(owner.id, project.id);
    expect(latest.type).toBe("task_dependency_changed");
    expect(latest.taskId).toBe(a.id);
  });

  it("建里程碑记 milestone_created", async () => {
    const { owner, project } = await scene();
    await createMilestone(owner.id, project.id, { title: "冲刺一" });

    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed[0].type).toBe("milestone_created");
    expect(feed[0].summary).toBe("新建里程碑「冲刺一」");
  });

  it("建项目自带一笔 project_created", async () => {
    const { owner, project } = await scene();
    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed).toHaveLength(1);
    expect(feed[0].summary).toBe("创建了项目「赤壁演习」");
  });
});

describe("删任务后历史仍在", () => {
  beforeEach(resetDb);

  it("事件不随任务 cascade 消失，且冻结了标题与原 id", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "将被删掉的任务" });
    await deleteTask(owner.id, t.id);

    const feed = await listProjectActivity(owner.id, project.id);
    const deleted = feed.find((e) => e.type === "task_deleted");
    expect(deleted).toBeDefined();
    // 外键已置空（任务没了），但摘要与 payload 仍能指认删的是哪一个
    expect(deleted?.taskId).toBeNull();
    expect(deleted?.summary).toBe("删除了任务「将被删掉的任务」");
    expect(deleted?.payload).toMatchObject({ taskId: t.id, title: "将被删掉的任务" });
  });
});

describe("活动流事务性", () => {
  beforeEach(resetDb);

  // 「零填写」的贡献记录全靠事件表，若批量落库中途失败还留下幻影事件，
  // 贡献数字便会凭空多出没发生过的动作。这是本表最该守住的一条不变量。
  it("AI 批量落库中途失败 → 任务与事件一并回滚，事件一条不留", async () => {
    const { owner, project } = await scene();
    const before = await listProjectActivity(owner.id, project.id);

    await expect(
      commitDraft(owner.id, project.id, "decompose_tasks", {
        tasks: [
          { title: "合法一" },
          { title: "非法二", milestoneId: "00000000-0000-0000-0000-000000000000" },
        ],
      }),
    ).rejects.toThrow();

    const after = await listProjectActivity(owner.id, project.id);
    expect(after).toHaveLength(before.length); // 未增一条
    expect(after.some((e) => e.type === "task_created")).toBe(false);
  });

  it("批量落库成功则每个任务各记一笔", async () => {
    const { owner, project } = await scene();
    await commitDraft(owner.id, project.id, "decompose_tasks", {
      tasks: [{ title: "甲" }, { title: "乙" }, { title: "丙" }],
    });

    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed.filter((e) => e.type === "task_created")).toHaveLength(3);
  });
});

describe("活动流权限与范围", () => {
  beforeEach(resetDb);

  it("非团队成员读活动流被拒", async () => {
    const { owner, outsider, project } = await scene();
    await createTask(owner.id, project.id, { title: "甲" });
    await expect(listProjectActivity(outsider.id, project.id)).rejects.toThrow("没有权限");
  });

  it("按任务筛只出该任务的事件", async () => {
    const { owner, project } = await scene();
    const a = await createTask(owner.id, project.id, { title: "甲" });
    await createTask(owner.id, project.id, { title: "乙" });

    const scoped = await listProjectActivity(owner.id, project.id, { taskId: a.id });
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((e) => e.taskId === a.id)).toBe(true);
  });

  it("倒序：最新一条在最前", async () => {
    const { owner, project } = await scene();
    const t = await createTask(owner.id, project.id, { title: "甲" });
    await updateTask(owner.id, t.id, { status: "doing" });
    await updateTask(owner.id, t.id, { status: "done" });

    const feed = await listProjectActivity(owner.id, project.id);
    expect(feed[0].payload).toMatchObject({ to: "done" });
    expect(feed[1].payload).toMatchObject({ to: "doing" });
  });
});

describe("recordEvent 的错误不被吞", () => {
  beforeEach(resetDb);

  it("非法 projectId 抛错而非静默丢弃", async () => {
    const { owner, project } = await scene();
    void project;
    const { db } = await import("@/db");
    await expect(
      recordEvent(db, {
        projectId: "00000000-0000-0000-0000-000000000000",
        actorId: owner.id,
        type: "task_created",
        summary: "指向不存在的项目",
      }),
    ).rejects.toThrow();
  });
});
