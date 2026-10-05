"use client";

import React, { useState } from "react";
import { RBACProvider, useRBAC } from "@/context/rbac-context";
import { RoleManagementPanel } from "@/components/rbac/role-management-panel";
import { RouteGuard } from "@/components/rbac/route-guard";
import { MOCK_EVALUATION } from "@/lib/rbac/mock-data";

function RBACDemoContent() {
  const [currentTab, setCurrentTab] = useState<"panel" | "teacher-eval">("panel");
  const { currentRole } = useRBAC();

  return (
    <div className="min-h-screen bg-ground text-ink">
      {/* 顶部导航 */}
      <header className="border-b border-stroke bg-panel/80 backdrop-blur sticky top-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-ground font-black text-sm">
              AC
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm sm:text-base">AgileCampus 敏捷校园</span>
                <span className="rounded bg-signal-soft px-1.5 py-0.5 text-[10px] font-semibold text-signal">
                  v0.2.0 新版
                </span>
              </div>
              <p className="text-[11px] text-ink-soft">角色分工与细粒度权限控制模块 (RBAC)</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentTab("panel")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                currentTab === "panel"
                  ? "bg-primary text-ground"
                  : "bg-sunken text-ink-soft hover:text-ink"
              }`}
            >
              角色分配与敏捷面板
            </button>
            <button
              type="button"
              onClick={() => setCurrentTab("teacher-eval")}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                currentTab === "teacher-eval"
                  ? "bg-purple-600 text-white"
                  : "bg-sunken text-ink-soft hover:text-ink"
              }`}
            >
              受限页面：导师打分评审 (需路由守卫)
            </button>
          </div>
        </div>
      </header>

      {/* 主体内容 */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {currentTab === "panel" ? (
          <div>
            <div className="mb-6">
              <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">
                敏捷项目角色与权限分工
              </h1>
              <p className="mt-1 text-sm text-ink-soft">
                支持组员 (Member)、组长 (Leader)、导师 (Supervisor) 三级敏捷角色及细粒度操作权限控制。
              </p>
            </div>

            <RoleManagementPanel />
          </div>
        ) : (
          /* 受限路由页面：使用 RouteGuard 进行保护拦截 */
          <div className="rounded-xl border border-stroke bg-panel p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between border-b border-stroke pb-3">
              <div>
                <h2 className="text-base font-bold text-ink">敏捷项目里程碑打分与综合评定</h2>
                <p className="text-xs text-ink-soft">
                  此页面受 <code className="text-primary font-mono">&lt;RouteGuard requiredRole="teacher"&gt;</code> 守卫保护
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentTab("panel")}
                className="ac-btn-ghost text-xs px-2.5 py-1"
              >
                ← 返回主面板
              </button>
            </div>

            <RouteGuard
              requiredRole="teacher"
              requiredPermission="evaluation:grade"
              onUnauthorized={() => {
                console.log(`[RouteGuard] 阻止非导师角色 (${currentRole}) 访问打分页`);
              }}
            >
              {/* 仅导师有权看到的打分与评价界面 */}
              <div className="space-y-4 animate-fade-in">
                <div className="rounded-lg bg-success-soft p-4 text-xs text-success border border-success/20">
                  ✓ 身份校验通过：您当前拥有【导师 (Supervisor)】权限，已获准访问项目评估与里程碑打分页。
                </div>

                <div className="rounded-xl border border-stroke bg-sunken/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sm">{MOCK_EVALUATION.milestoneTitle}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700 font-bold">
                      评分等级：{MOCK_EVALUATION.grade} ({MOCK_EVALUATION.score}分)
                    </span>
                  </div>
                  <div className="text-xs text-ink-2 bg-panel p-3 rounded-lg border border-stroke">
                    <p className="font-medium text-ink mb-1">导师评审意见：</p>
                    <p>{MOCK_EVALUATION.comment}</p>
                  </div>
                  <div className="text-[11px] text-ink-soft">
                    评估人：{MOCK_EVALUATION.evaluatorName} · 时间：{MOCK_EVALUATION.evaluatedAt}
                  </div>
                </div>

                <div className="flex gap-2">
                  <button type="button" className="ac-btn text-xs px-4 py-2">
                    提交新轮次综合评分
                  </button>
                  <button type="button" className="ac-btn-ghost text-xs px-4 py-2">
                    导出项目质量评估 PDF
                  </button>
                </div>
              </div>
            </RouteGuard>
          </div>
        )}
      </main>
    </div>
  );
}

export default function RBACDemoPage() {
  return (
    <RBACProvider>
      <RBACDemoContent />
    </RBACProvider>
  );
}
