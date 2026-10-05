import {
  type Permission,
  type Role,
  ROLE_PERMISSIONS_MAP,
  ROLE_DEFINITIONS,
} from "@/types/rbac";

/**
 * 判断指定角色是否拥有目标权限
 */
export function hasRolePermission(role: Role, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS_MAP[role];
  return allowed ? allowed.includes(permission) : false;
}

/**
 * 校验给定权限集合中是否包含目标权限
 */
export function checkPermission(
  userPermissions: readonly Permission[],
  permission: Permission,
): boolean {
  return userPermissions.includes(permission);
}

/**
 * 校验是否满足所有指定权限 (AND 逻辑)
 */
export function checkAllPermissions(
  userPermissions: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.every((p) => userPermissions.includes(p));
}

/**
 * 校验是否满足任一指定权限 (OR 逻辑)
 */
export function checkAnyPermission(
  userPermissions: readonly Permission[],
  required: readonly Permission[],
): boolean {
  return required.some((p) => userPermissions.includes(p));
}

/**
 * 任务修改卡片权限检查：
 * 业务铁律：老师不能直接修改日常敏捷卡片状态（避免干扰学生开发节奏）
 */
export function canModifyAgileCard(role: Role, isSelfTask: boolean = false): boolean {
  if (role === "teacher") {
    return false; // 严格限制：老师禁止直接修改卡片
  }
  if (role === "leader") {
    return true; // 组长可以修改任意卡片
  }
  if (role === "member") {
    return isSelfTask; // 组员仅能更新自己认领的任务
  }
  return false;
}

/**
 * 获取角色的所有权限列表
 */
export function getPermissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS_MAP[role] || [];
}

/**
 * 获取角色元数据描述
 */
export function getRoleDefinition(role: Role) {
  return ROLE_DEFINITIONS[role];
}
