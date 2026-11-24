import { describe, it, expect, beforeEach } from "vitest";
import {
  ROLE_PERMISSIONS_MAP,
  ROLE_DEFINITIONS,
  type Role,
} from "@/types/rbac";
import {
  hasRolePermission,
  checkPermission,
  checkAllPermissions,
  checkAnyPermission,
  canModifyAgileCard,
  getPermissionsForRole,
} from "@/lib/rbac/permissions";
import {
  getProjectMembers,
  updateProjectMemberRole,
  getMyProjectPermissions,
  resetMockMembers,
} from "@/lib/rbac/api";

describe("RBAC 角色与权限矩阵测试 (Role-Permission Matrix)", () => {
  it("组员 (Member) 拥有基础看板操作与认领权限，但无管理及打分权限", () => {
    const memberPerms = getPermissionsForRole("member");

    // 允许的操作
    expect(checkPermission(memberPerms, "board:view")).toBe(true);
    expect(checkPermission(memberPerms, "sprint:view")).toBe(true);
    expect(checkPermission(memberPerms, "task:claim")).toBe(true);
    expect(checkPermission(memberPerms, "task:update_self")).toBe(true);
    expect(checkPermission(memberPerms, "task:log_hours")).toBe(true);
    expect(checkPermission(memberPerms, "evidence:submit")).toBe(true);

    // 禁止的操作
    expect(checkPermission(memberPerms, "task:create")).toBe(false);
    expect(checkPermission(memberPerms, "sprint:start")).toBe(false);
    expect(checkPermission(memberPerms, "member:manage_roles")).toBe(false);
    expect(checkPermission(memberPerms, "evaluation:grade")).toBe(false);
  });

  it("组长 (Leader) 继承组员全部权限，并享有任务调度与 Sprint 迭代管理特权", () => {
    const leaderPerms = getPermissionsForRole("leader");
    const memberPerms = getPermissionsForRole("member");

    // 验证严格继承组员全部权限
    for (const perm of memberPerms) {
      expect(checkPermission(leaderPerms, perm)).toBe(true);
    }

    // 验证组长特权
    expect(checkPermission(leaderPerms, "task:create")).toBe(true);
    expect(checkPermission(leaderPerms, "task:decompose")).toBe(true);
    expect(checkPermission(leaderPerms, "task:assign")).toBe(true);
    expect(checkPermission(leaderPerms, "task:prioritize")).toBe(true);
    expect(checkPermission(leaderPerms, "sprint:start")).toBe(true);
    expect(checkPermission(leaderPerms, "sprint:close")).toBe(true);
    expect(checkPermission(leaderPerms, "member:manage_roles")).toBe(true);

    // 组长不拥有导师专属的评审打分权
    expect(checkPermission(leaderPerms, "evaluation:grade")).toBe(false);
  });

  it("导师 (Teacher) 具备全局视界与评审打分权，但禁止修改日常敏捷卡片", () => {
    const teacherPerms = getPermissionsForRole("teacher");

    // 允许的全局查看与评估权限
    expect(checkPermission(teacherPerms, "board:view")).toBe(true);
    expect(checkPermission(teacherPerms, "burndown:view")).toBe(true);
    expect(checkPermission(teacherPerms, "sprint_log:view")).toBe(true);
    expect(checkPermission(teacherPerms, "evaluation:view")).toBe(true);
    expect(checkPermission(teacherPerms, "milestone:approve")).toBe(true);
    expect(checkPermission(teacherPerms, "evaluation:comment")).toBe(true);
    expect(checkPermission(teacherPerms, "evaluation:grade")).toBe(true);
    expect(checkPermission(teacherPerms, "report:export")).toBe(true);

    // 铁律：禁止修改日常敏捷卡片状态或创建任务
    expect(checkPermission(teacherPerms, "task:update_status")).toBe(false);
    expect(checkPermission(teacherPerms, "task:claim")).toBe(false);
    expect(checkPermission(teacherPerms, "task:create")).toBe(false);
  });
});

describe("敏捷卡片修改权限规则 (canModifyAgileCard)", () => {
  it("导师 (Teacher) 无论何时均不能直接修改日常敏捷卡片状态", () => {
    expect(canModifyAgileCard("teacher", false)).toBe(false);
    expect(canModifyAgileCard("teacher", true)).toBe(false);
  });

  it("组长 (Leader) 可以修改任何人的卡片", () => {
    expect(canModifyAgileCard("leader", false)).toBe(true);
    expect(canModifyAgileCard("leader", true)).toBe(true);
  });

  it("组员 (Member) 仅能修改自己认领的任务卡片", () => {
    expect(canModifyAgileCard("member", false)).toBe(false);
    expect(canModifyAgileCard("member", true)).toBe(true);
  });
});

describe("复合权限检查工具函数", () => {
  const testPermissions = ["board:view", "task:claim", "task:update_self"] as const;

  it("checkAllPermissions 校验 AND 规则", () => {
    expect(checkAllPermissions(testPermissions, ["board:view", "task:claim"])).toBe(true);
    expect(checkAllPermissions(testPermissions, ["board:view", "task:create"])).toBe(false);
  });

  it("checkAnyPermission 校验 OR 规则", () => {
    expect(checkAnyPermission(testPermissions, ["task:create", "board:view"])).toBe(true);
    expect(checkAnyPermission(testPermissions, ["task:create", "sprint:start"])).toBe(false);
  });

  it("hasRolePermission 快捷校验", () => {
    expect(hasRolePermission("leader", "sprint:start")).toBe(true);
    expect(hasRolePermission("member", "sprint:start")).toBe(false);
  });
});

describe("RESTful Mock API 接口行为测试", () => {
  beforeEach(() => {
    resetMockMembers();
  });

  it("getProjectMembers 成功返回项目成员列表", async () => {
    const members = await getProjectMembers("proj-agile-001");
    expect(members.length).toBeGreaterThan(0);
    expect(members.some((m) => m.role === "leader")).toBe(true);
  });

  it("updateProjectMemberRole 能够正确修改成员角色", async () => {
    const membersBefore = await getProjectMembers("proj-agile-001");
    const target = membersBefore.find((m) => m.role === "member");
    expect(target).toBeDefined();

    const res = await updateProjectMemberRole("proj-agile-001", target!.userId, "leader");
    expect(res.success).toBe(true);
    expect(res.member.role).toBe("leader");

    const myPerms = await getMyProjectPermissions("proj-agile-001", target!.userId);
    expect(myPerms.role).toBe("leader");
    expect(myPerms.permissions.includes("sprint:start")).toBe(true);
  });

  it("getMyProjectPermissions 正确返回用户的角色与动态权限列表", async () => {
    const members = await getProjectMembers("proj-agile-001");
    const teacherMember = members.find((m) => m.role === "teacher");
    expect(teacherMember).toBeDefined();

    const perms = await getMyProjectPermissions("proj-agile-001", teacherMember!.userId);
    expect(perms.role).toBe("teacher");
    expect(perms.permissions.includes("evaluation:grade")).toBe(true);
    expect(perms.permissions.includes("task:create")).toBe(false);
  });
});
