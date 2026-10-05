"use client";

import React from "react";
import type { Permission, Role } from "@/types/rbac";
import { useRBAC } from "@/context/rbac-context";

export interface PermissionGuardProps {
  children: React.ReactNode;
  /** 需要的细粒度操作权限 */
  permission?: Permission | Permission[];
  /** 需要的角色限制 */
  role?: Role | Role[];
  /** 多个权限时的匹配模式：all (全部满足) | any (满足其一)，默认 all */
  match?: "all" | "any";
  /** 无权限时的处理策略：hide (隐藏，默认) | disable (置灰并禁用点击) */
  mode?: "hide" | "disable";
  /** 无权限时的自定义降级展示（仅在 mode="hide" 时生效） */
  fallback?: React.ReactNode;
  /** 置灰时的提示文案（鼠标悬浮提示） */
  disabledTooltip?: string;
  /** 附加 className（仅在 mode="disable" 包装层时生效） */
  className?: string;
}

/**
 * 敏捷团队权限守卫组件
 * 支持角色维度与操作权限维度的声明式鉴权
 */
export function PermissionGuard({
  children,
  permission,
  role,
  match = "all",
  mode = "hide",
  fallback = null,
  disabledTooltip,
  className = "",
}: PermissionGuardProps) {
  const { currentRole, permissions } = useRBAC();

  // 1. 角色匹配检查
  let roleMatched = true;
  if (role) {
    if (Array.isArray(role)) {
      roleMatched = role.includes(currentRole);
    } else {
      roleMatched = currentRole === role;
    }
  }

  // 2. 权限匹配检查
  let permissionMatched = true;
  if (permission) {
    const requiredList = Array.isArray(permission) ? permission : [permission];
    if (match === "all") {
      permissionMatched = requiredList.every((p) => permissions.includes(p));
    } else {
      permissionMatched = requiredList.some((p) => permissions.includes(p));
    }
  }

  const isAuthorized = roleMatched && permissionMatched;

  // 3. 有权限时直接渲染原组件
  if (isAuthorized) {
    return <>{children}</>;
  }

  // 4. 无权限且策略为隐藏
  if (mode === "hide") {
    return <>{fallback}</>;
  }

  // 5. 无权限且策略为置灰禁用 (Disable)
  const tooltipText =
    disabledTooltip ||
    (currentRole === "teacher"
      ? "导师具有全局评估视界，为避免干扰开发节奏，该敏捷操作已被禁用"
      : "当前角色权限不足，无法执行此操作");

  return (
    <div
      className={`relative inline-flex items-center cursor-not-allowed group ${className}`}
      title={tooltipText}
      aria-disabled="true"
    >
      <div className="pointer-events-none opacity-45 select-none filter grayscale">
        {children}
      </div>
    </div>
  );
}
