"use client";

import React, { useState } from "react";
import type { Role } from "@/types/rbac";
import { ROLE_DEFINITIONS, ROLE_PERMISSIONS_MAP } from "@/types/rbac";
import { useRBAC } from "@/context/rbac-context";
import { PermissionGuard } from "./permission-guard";
import { Badge } from "@/components/ui/badge";

export function RoleManagementPanel() {
  const {
    currentRole,
    currentUser,
    members,
    isLoading,
    switchRole,
    updateMemberRole,
  } = useRBAC();

  const [activeTab, setActiveTab] = useState<"members" | "matrix">("members");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  // 统计各角色人数
  const counts = {
    leader: members.filter((m) => m.role === "leader").length,
    member: members.filter((m) => m.role === "member").length,
    teacher: members.filter((m) => m.role === "teacher").length,
  };

  const handleRoleChange = async (userId: string, newRole: Role) => {
    try {
      setUpdatingUserId(userId);
      await updateMemberRole(userId, newRole);
      setFeedbackMessage("成员角色已成功更新并生效");
      setTimeout(() => setFeedbackMessage(null), 3000);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "更新失败";
      setFeedbackMessage(`更新失败: ${msg}`);
    } finally {
      setUpdatingUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. 顶部操作条与调试身份切换栏 */}
      <div className="rounded-xl border border-stroke bg-panel p-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                当前会话身份模拟
              </span>
              <span className="text-xs text-ink-soft">（可实时切换体验不同角色视图）</span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-medium text-ink">{currentUser.name}</span>
              <Badge tone={ROLE_DEFINITIONS[currentRole].badgeTone}>
                {ROLE_DEFINITIONS[currentRole].name}
              </Badge>
            </div>
          </div>

          {/* 角色切换按钮组 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-ink-soft">切换视角：</span>
            {(["leader", "member", "teacher"] as Role[]).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => switchRole(r)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  currentRole === r
                    ? "bg-ink text-ground shadow-sm"
                    : "bg-sunken text-ink-2 hover:bg-neutral-200 hover:text-ink"
                }`}
              >
                {ROLE_DEFINITIONS[r].name.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. 角色概览统计卡片 */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-stroke bg-panel p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-soft">组长 (Leader)</span>
            <Badge tone="signal">{counts.leader} 人</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-2">负责任务分解、Sprint 管理与全组成员任务调度。</p>
        </div>

        <div className="rounded-xl border border-stroke bg-panel p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-soft">组员 (Member)</span>
            <Badge tone="human">{counts.member} 人</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-2">认领任务、推进状态、填报工时与提交成果物。</p>
        </div>

        <div className="rounded-xl border border-stroke bg-panel p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-soft">导师 (Supervisor)</span>
            <Badge tone="agent">{counts.teacher} 人</Badge>
          </div>
          <p className="mt-2 text-xs text-ink-2">全局质量把控、里程碑打分；禁止直接干预日常任务。</p>
        </div>
      </div>

      {/* 3. 反馈提示 */}
      {feedbackMessage && (
        <div className="rounded-lg bg-success-soft px-4 py-2 text-sm text-success border border-success/30 flex items-center justify-between animate-fade-in">
          <span>{feedbackMessage}</span>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-xs text-ink-soft hover:text-ink"
          >
            ✕
          </button>
        </div>
      )}

      {/* 4. 成员角色分配与权限矩阵 Tab 切换 */}
      <div className="rounded-xl border border-stroke bg-panel overflow-hidden shadow-sm">
        <div className="flex border-b border-stroke bg-sunken/40 px-4 pt-3">
          <button
            type="button"
            onClick={() => setActiveTab("members")}
            className={`pb-3 px-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "members"
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            项目成员角色列表 ({members.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("matrix")}
            className={`pb-3 px-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "matrix"
                ? "border-primary text-primary font-semibold"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            RBAC 权限对照矩阵
          </button>
        </div>

        {activeTab === "members" ? (
          <div className="divide-y divide-stroke">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-ink-soft">加载成员列表中...</div>
            ) : (
              members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 hover:bg-sunken/30 transition-colors"
                >
                  {/* 用户基本信息 */}
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sunken border border-stroke font-medium text-ink">
                      {member.user.name.slice(0, 2)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink text-sm">{member.user.name}</span>
                        {member.user.kind === "agent" && (
                          <Badge tone="agent" className="text-[10px] py-0 px-1.5">AI Agent</Badge>
                        )}
                        {member.userId === currentUser.id && (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                            当前操作者
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-soft">{member.user.email}</div>
                    </div>
                  </div>

                  {/* 角色与权限变更操作 */}
                  <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                      <div className="text-xs text-ink-soft">当前角色</div>
                      <div className="text-xs font-medium text-ink">
                        {ROLE_DEFINITIONS[member.role].name}
                      </div>
                    </div>

                    {/* 权限守卫包裹：仅组长/管理员允许修改角色，其他身份置灰禁用 */}
                    <PermissionGuard
                      permission="member:manage_roles"
                      mode="disable"
                      disabledTooltip="仅组长 (Leader) 拥有调整成员角色的权限"
                    >
                      <select
                        aria-label={`修改 ${member.user.name} 的角色`}
                        value={member.role}
                        disabled={updatingUserId === member.userId}
                        onChange={(e) =>
                          handleRoleChange(member.userId, e.target.value as Role)
                        }
                        className="rounded-lg border border-stroke bg-panel px-3 py-1.5 text-xs font-medium text-ink shadow-sm focus:border-primary focus:outline-none"
                      >
                        <option value="leader">组长 (Leader)</option>
                        <option value="member">组员 (Member)</option>
                        <option value="teacher">导师 (Supervisor)</option>
                      </select>
                    </PermissionGuard>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* 5. 权限对照矩阵视图 */
          <div className="overflow-x-auto p-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-stroke text-ink-soft font-medium">
                  <th className="py-2 px-3">功能模块与操作项</th>
                  <th className="py-2 px-3 text-center">组员 (Member)</th>
                  <th className="py-2 px-3 text-center">组长 (Leader)</th>
                  <th className="py-2 px-3 text-center">导师 (Supervisor)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stroke text-ink">
                <tr>
                  <td className="py-2.5 px-3 font-medium">敏捷看板与 Sprint 列表查看</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-success font-semibold">✓</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">认领/更新自己负责的任务</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-risk font-semibold">✕ (禁止干预)</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">创建/拆分/指派任务卡片</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-risk">✕</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">开启/关闭 Sprint 迭代周期</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-risk">✕</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">分配与变更成员角色</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-risk">✕</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">全局燃尽图与迭代审计查看</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-success font-semibold">✓</td>
                  <td className="text-center text-success font-semibold">✓</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">里程碑审批与打分评价</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-success font-semibold">✓</td>
                </tr>
                <tr>
                  <td className="py-2.5 px-3 font-medium">导出综合统计报告</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-risk">✕</td>
                  <td className="text-center text-success font-semibold">✓</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 6. 快捷操作区 (敏捷操作权限守卫验证展示) */}
      <div className="rounded-xl border border-stroke bg-panel p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-ink mb-3">当前身份敏捷动作可用性演示</h3>
        <div className="flex flex-wrap gap-3">
          {/* 只有组长能开启 Sprint */}
          <PermissionGuard
            permission="sprint:start"
            mode="disable"
            disabledTooltip="开启新 Sprint 需要组长 (Leader) 权限"
          >
            <button
              type="button"
              className="ac-btn text-xs px-3 py-2 rounded-lg"
              onClick={() => alert("开启新 Sprint！")}
            >
              🚀 开启新 Sprint
            </button>
          </PermissionGuard>

          {/* 只有组长能新建任务 */}
          <PermissionGuard
            permission="task:create"
            mode="disable"
            disabledTooltip="新建任务卡片需要组长 (Leader) 权限"
          >
            <button
              type="button"
              className="ac-btn-ghost text-xs px-3 py-2 rounded-lg"
              onClick={() => alert("新建任务卡片！")}
            >
              + 新建任务卡片
            </button>
          </PermissionGuard>

          {/* 只有组员和组长能提交成果物 */}
          <PermissionGuard
            permission="evidence:submit"
            mode="disable"
            disabledTooltip="提交交付成果物需要组员或组长权限"
          >
            <button
              type="button"
              className="ac-btn-ghost text-xs px-3 py-2 rounded-lg"
              onClick={() => alert("提交成果物记录！")}
            >
              📎 提交成果物
            </button>
          </PermissionGuard>

          {/* 只有导师能进行项目打分 */}
          <PermissionGuard
            permission="evaluation:grade"
            mode="disable"
            disabledTooltip="项目评审与打分仅限导师 (Supervisor)"
          >
            <button
              type="button"
              className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-medium text-white hover:bg-purple-700"
              onClick={() => alert("导师评审打分弹窗！")}
            >
              ★ 导师评审打分
            </button>
          </PermissionGuard>
        </div>
      </div>
    </div>
  );
}
