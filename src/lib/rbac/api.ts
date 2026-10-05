import type { ProjectMember, Role, Permission } from "@/types/rbac";
import { MOCK_PROJECT_MEMBERS } from "./mock-data";
import { getPermissionsForRole } from "./permissions";

/**
 * 内存状态缓存（供前端即时联调与 Mock 测试）
 */
let currentMembers: ProjectMember[] = [...MOCK_PROJECT_MEMBERS];

/**
 * RESTful 规范定义：
 * 1. GET /api/projects/:projectId/members - 获取项目成员与角色列表
 * 2. PATCH /api/projects/:projectId/members/:userId/role - 修改指定成员在项目内的角色
 * 3. GET /api/projects/:projectId/permissions/me - 获取当前登录人在该项目的角色及权限列表
 */

/**
 * 获取项目成员列表
 */
export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  // 模拟网络延迟
  await new Promise((resolve) => setTimeout(resolve, 50));
  return currentMembers.filter((m) => m.projectId === projectId);
}

/**
 * 组长/管理员更新成员角色
 */
export async function updateProjectMemberRole(
  projectId: string,
  userId: string,
  newRole: Role,
): Promise<{ success: boolean; member: ProjectMember }> {
  await new Promise((resolve) => setTimeout(resolve, 50));

  const index = currentMembers.findIndex(
    (m) => m.projectId === projectId && m.userId === userId,
  );

  if (index === -1) {
    throw new Error(`未找到项目成员 (userId=${userId})`);
  }

  currentMembers[index] = {
    ...currentMembers[index],
    role: newRole,
  };

  return { success: true, member: currentMembers[index] };
}

/**
 * 查询当前用户在项目内的角色与权限
 */
export async function getMyProjectPermissions(
  projectId: string,
  currentUserId: string,
): Promise<{
  role: Role | null;
  permissions: readonly Permission[];
  member: ProjectMember | null;
}> {
  await new Promise((resolve) => setTimeout(resolve, 50));

  const member = currentMembers.find(
    (m) => m.projectId === projectId && m.userId === currentUserId,
  );

  if (!member) {
    return { role: null, permissions: [], member: null };
  }

  return {
    role: member.role,
    permissions: getPermissionsForRole(member.role),
    member,
  };
}

/**
 * 重置 Mock 状态（供单元测试使用）
 */
export function resetMockMembers() {
  currentMembers = [...MOCK_PROJECT_MEMBERS];
}
