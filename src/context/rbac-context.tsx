"use client";

import React, {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useEffect,
} from "react";
import type { Role, Permission, ProjectMember, User } from "@/types/rbac";
import {
  getPermissionsForRole,
  checkPermission,
  canModifyAgileCard,
} from "@/lib/rbac/permissions";
import {
  getProjectMembers,
  updateProjectMemberRole,
} from "@/lib/rbac/api";
import { MOCK_USERS } from "@/lib/rbac/mock-data";

export interface RBACContextState {
  projectId: string;
  currentUser: User;
  currentRole: Role;
  permissions: readonly Permission[];
  members: ProjectMember[];
  isLoading: boolean;
  hasPermission: (permission: Permission) => boolean;
  hasRole: (role: Role | Role[]) => boolean;
  canModifyTaskCard: (isSelfTask?: boolean) => boolean;
  switchRole: (role: Role) => void;
  updateMemberRole: (userId: string, newRole: Role) => Promise<void>;
  reloadMembers: () => Promise<void>;
}

const RBACContext = createContext<RBACContextState | undefined>(undefined);

export interface RBACProviderProps {
  children: React.ReactNode;
  initialProjectId?: string;
  initialRole?: Role;
  initialUser?: User;
}

export function RBACProvider({
  children,
  initialProjectId = "proj-agile-001",
  initialRole = "leader",
  initialUser = MOCK_USERS.u1,
}: RBACProviderProps) {
  const [projectId] = useState<string>(initialProjectId);
  const [currentUser, setCurrentUser] = useState<User>(initialUser);
  const [currentRole, setCurrentRole] = useState<Role>(initialRole);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 计算当前角色拥有的全部权限列表
  const permissions = useMemo(() => {
    return getPermissionsForRole(currentRole);
  }, [currentRole]);

  // 刷新项目成员
  const reloadMembers = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getProjectMembers(projectId);
      setMembers(data);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reloadMembers();
  }, [reloadMembers]);

  // 权限检查辅助方法
  const hasPermission = useCallback(
    (permission: Permission): boolean => {
      return checkPermission(permissions, permission);
    },
    [permissions],
  );

  const hasRole = useCallback(
    (role: Role | Role[]): boolean => {
      if (Array.isArray(role)) {
        return role.includes(currentRole);
      }
      return currentRole === role;
    },
    [currentRole],
  );

  const canModifyTaskCard = useCallback(
    (isSelfTask: boolean = false): boolean => {
      return canModifyAgileCard(currentRole, isSelfTask);
    },
    [currentRole],
  );

  // 角色切换（用于演示与多身份体验）
  const switchRole = useCallback((newRole: Role) => {
    setCurrentRole(newRole);
    // 联动切换当前模拟用户
    if (newRole === "leader") setCurrentUser(MOCK_USERS.u1);
    else if (newRole === "member") setCurrentUser(MOCK_USERS.u2);
    else if (newRole === "teacher") setCurrentUser(MOCK_USERS.u4);
  }, []);

  // 更新成员角色
  const updateMemberRole = useCallback(
    async (userId: string, newRole: Role) => {
      const res = await updateProjectMemberRole(projectId, userId, newRole);
      if (res.success) {
        setMembers((prev) =>
          prev.map((m) => (m.userId === userId ? res.member : m)),
        );
      }
    },
    [projectId],
  );

  const value = useMemo<RBACContextState>(
    () => ({
      projectId,
      currentUser,
      currentRole,
      permissions,
      members,
      isLoading,
      hasPermission,
      hasRole,
      canModifyTaskCard,
      switchRole,
      updateMemberRole,
      reloadMembers,
    }),
    [
      projectId,
      currentUser,
      currentRole,
      permissions,
      members,
      isLoading,
      hasPermission,
      hasRole,
      canModifyTaskCard,
      switchRole,
      updateMemberRole,
      reloadMembers,
    ],
  );

  return <RBACContext.Provider value={value}>{children}</RBACContext.Provider>;
}

/**
 * 访问 RBAC 上下文的自定义 Hook
 */
export function useRBAC(): RBACContextState {
  const context = useContext(RBACContext);
  if (!context) {
    throw new Error("useRBAC 必须在 RBACProvider 内使用");
  }
  return context;
}

/**
 * 快捷权限检查 Hook
 */
export function usePermission(permission: Permission): boolean {
  const { hasPermission } = useRBAC();
  return hasPermission(permission);
}
