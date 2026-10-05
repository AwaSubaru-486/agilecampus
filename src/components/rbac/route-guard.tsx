"use client";

import React from "react";
import type { Permission, Role } from "@/types/rbac";
import { useRBAC } from "@/context/rbac-context";
import { ROLE_DEFINITIONS } from "@/types/rbac";

export interface Forbidden403Props {
  requiredRole?: Role | Role[];
  requiredPermission?: Permission | Permission[];
  title?: string;
  description?: string;
  onBack?: () => void;
}

/**
 * 敏捷校园标准 403 无权限页面组件
 */
export function Forbidden403({
  requiredRole,
  requiredPermission,
  title = "403 - 访问受限",
  description,
  onBack,
}: Forbidden403Props) {
  const { currentRole, switchRole } = useRBAC();

  const roleText = requiredRole
    ? Array.isArray(requiredRole)
      ? requiredRole.map((r) => ROLE_DEFINITIONS[r]?.name).join(" 或 ")
      : ROLE_DEFINITIONS[requiredRole]?.name
    : null;

  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center p-8 text-center animate-fade-in">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-risk/10 text-risk">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 15v2m0 0v2m0-2h2m-2 0H10m4-11a4 4 0 00-8 0v4h8V6zM6 10h12a2 2 0 012 2v7a2 2 0 01-2 2H6a2 2 0 01-2-2v-7a2 2 0 012-2z"
          />
        </svg>
      </div>

      <h2 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h2>

      <p className="mt-2 max-w-md text-sm text-ink-soft">
        {description ||
          `您当前的项目角色为【${ROLE_DEFINITIONS[currentRole]?.name}】，缺少访问此敏捷工作面所需的权限${
            roleText ? `（该页面通常仅限【${roleText}】访问）` : ""
          }。`}
      </p>

      {requiredPermission && (
        <div className="mt-3 inline-block rounded-md bg-sunken px-2.5 py-1 text-xs font-mono text-ink-2">
          所需权限: {Array.isArray(requiredPermission) ? requiredPermission.join(", ") : requiredPermission}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="ac-btn-ghost text-sm px-4 py-2 rounded-lg"
          >
            返回上一页
          </button>
        )}

        {/* 演示便利：若需要导师角色，提供快速体验切换按钮 */}
        {requiredRole === "teacher" && currentRole !== "teacher" && (
          <button
            type="button"
            onClick={() => switchRole("teacher")}
            className="ac-btn text-sm px-4 py-2 rounded-lg"
          >
            切换至导师视角体验
          </button>
        )}
      </div>
    </div>
  );
}

export interface RouteGuardProps {
  children: React.ReactNode;
  requiredRole?: Role | Role[];
  requiredPermission?: Permission | Permission[];
  fallback?: React.ReactNode;
  onUnauthorized?: () => void;
}

/**
 * 受限页面路由守卫容器组件
 */
export function RouteGuard({
  children,
  requiredRole,
  requiredPermission,
  fallback,
  onUnauthorized,
}: RouteGuardProps) {
  const { currentRole, permissions } = useRBAC();

  // 1. 角色校验
  let rolePass = true;
  if (requiredRole) {
    if (Array.isArray(requiredRole)) {
      rolePass = requiredRole.includes(currentRole);
    } else {
      rolePass = currentRole === requiredRole;
    }
  }

  // 2. 权限校验
  let permissionPass = true;
  if (requiredPermission) {
    const list = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    permissionPass = list.every((p) => permissions.includes(p));
  }

  const isAuthorized = rolePass && permissionPass;

  if (!isAuthorized) {
    if (onUnauthorized) {
      onUnauthorized();
    }
    return (
      fallback || (
        <Forbidden403
          requiredRole={requiredRole}
          requiredPermission={requiredPermission}
        />
      )
    );
  }

  return <>{children}</>;
}
