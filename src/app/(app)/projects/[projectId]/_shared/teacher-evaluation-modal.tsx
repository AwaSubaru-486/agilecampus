"use client";

import React, { useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { gradeMilestoneAction, type FormState } from "../actions";

export type MilestoneSummary = {
  id: string;
  title: string;
  targetDate?: string | null;
  status?: string;
};

export function TeacherEvaluationModal({
  projectId,
  projectName,
  role,
  milestones,
}: {
  projectId: string;
  projectName: string;
  role: "admin" | "teacher" | "student";
  milestones: MilestoneSummary[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string>(
    milestones[0]?.id || "",
  );
  const [selectedGrade, setSelectedGrade] = useState("A");
  const [score, setScore] = useState(90);
  const [comment, setComment] = useState("");
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const isTeacher = role === "teacher";
  const isAdmin = role === "admin";
  const canGrade = isTeacher || isAdmin;

  const currentMilestone = milestones.find((m) => m.id === selectedMilestoneId) || milestones[0];

  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev, fd) => {
      setSuccessMsg(null);
      try {
        const res = await gradeMilestoneAction(prev, fd);
        if (!res || !("error" in res)) {
          setSuccessMsg("✅ 导师评审打分已成功提交并归档到项目档案！");
          setComment("");
          router.refresh();
          return null;
        }
        return res;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "提交失败";
        return { error: msg };
      }
    },
    null,
  );

  const handleExportReport = () => {
    const reportContent = `# ${projectName} - 敏捷项目导师质量评估报告
生成时间: ${new Date().toLocaleString("zh-CN")}
评估导师: ${isTeacher ? "导师 (Teacher)" : "管理员 (Admin)"}
评估里程碑: ${currentMilestone?.title ?? "当前迭代"}
评定等级: ${selectedGrade}
综合得分: ${score} 分

## 导师评审意见
${comment.trim() || "项目迭代节奏良好，任务流转与成果交付符合敏捷开发规范。"}

---
AgileCampus 敏捷校园团队协同平台
`;
    const blob = new Blob([reportContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${projectName}_导师质量评估报告_${new Date().toISOString().slice(0, 10)}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* 顶部触发按钮与身份标识 */}
      <div className="flex items-center gap-2">
        {isTeacher ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-purple-700 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
          >
            <span>★ 导师评审打分</span>
          </button>
        ) : isAdmin ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 hover:bg-purple-100 transition-colors"
          >
            <span>★ 里程碑评审 (导师视角)</span>
          </button>
        ) : (
          <span className="rounded bg-sunken px-2 py-0.5 text-xs text-ink-3">
            组员视角 (只读评估)
          </span>
        )}
      </div>

      {/* 评审打分弹窗 */}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm animate-fade-in"
        >
          <div className="relative w-full max-w-lg rounded-2xl border border-stroke bg-panel p-6 shadow-2xl space-y-4">
            {/* 弹窗头部 */}
            <div className="flex items-start justify-between border-b border-stroke pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex size-6 items-center justify-center rounded bg-purple-600 text-xs font-bold text-white">
                    ★
                  </span>
                  <h3 className="text-base font-bold text-ink">敏捷项目里程碑评审与导师打分</h3>
                </div>
                <p className="mt-1 text-xs text-ink-3">
                  面向导师 (Supervisor) 的综合评估、里程碑审批与质量评语系统
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-3 hover:bg-sunken hover:text-ink text-sm"
              >
                ✕
              </button>
            </div>

            {/* 导师权限说明横幅 */}
            <div className="rounded-lg bg-purple-50 p-3 text-xs text-purple-800 border border-purple-200">
              <span className="font-semibold">🔒 角色职责约定：</span>
              导师拥有全局质量评估与里程碑打分权；不直接修改或拖拽日常敏捷卡片，保障学生团队自主敏捷节奏。
            </div>

            {/* 核心打分表单 */}
            <form action={formAction} className="space-y-4">
              <input type="hidden" name="projectId" value={projectId} />
              <input
                type="hidden"
                name="milestoneTitle"
                value={currentMilestone?.title ?? "当前敏捷迭代"}
              />

              {/* 里程碑选择 */}
              <div>
                <label className="block text-xs font-semibold text-ink-2 mb-1">
                  评定里程碑 (Milestone)
                </label>
                {milestones.length > 0 ? (
                  <select
                    name="milestoneId"
                    value={selectedMilestoneId}
                    onChange={(e) => setSelectedMilestoneId(e.target.value)}
                    className="ac-field w-full text-xs"
                  >
                    {milestones.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title} {m.targetDate ? `(截止: ${m.targetDate})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-ink-3">该项目暂未创建里程碑，请先联系组长设立。</p>
                )}
              </div>

              {/* 等级与分数 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-ink-2 mb-1">
                    评定等级 (Grade)
                  </label>
                  <select
                    name="grade"
                    value={selectedGrade}
                    onChange={(e) => setSelectedGrade(e.target.value)}
                    className="ac-field w-full text-xs"
                  >
                    <option value="S">S - 卓越 (Outstanding)</option>
                    <option value="A">A - 优秀 (Excellent)</option>
                    <option value="B">B - 良好 (Good)</option>
                    <option value="C">C - 及格 (Passing)</option>
                    <option value="D">D - 需返工整改 (Rework)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-ink-2 mb-1">
                    量化打分 (0 - 100)
                  </label>
                  <input
                    type="number"
                    name="score"
                    min="0"
                    max="100"
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                    required
                    className="ac-field w-full text-xs"
                  />
                </div>
              </div>

              {/* 导师评语 */}
              <div>
                <label className="block text-xs font-semibold text-ink-2 mb-1">
                  导师评审指导评语 (Comment)
                </label>
                <textarea
                  name="comment"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  required
                  rows={3}
                  placeholder="写下对本阶段代码成果、迭代节奏及团队协作的综合评价与后续指导要求…"
                  className="ac-field w-full text-xs"
                />
              </div>

              {/* 反馈提示 */}
              {state && "error" in state && (
                <p className="text-xs text-risk bg-risk/10 p-2 rounded">
                  ⚠️ {state.error}
                </p>
              )}
              {successMsg && (
                <p className="text-xs text-success bg-success/10 p-2 rounded">
                  {successMsg}
                </p>
              )}

              {/* 底部操作区 */}
              <div className="flex items-center justify-between pt-2 border-t border-stroke">
                <button
                  type="button"
                  onClick={handleExportReport}
                  className="ac-btn-ghost text-xs px-2.5 py-1.5"
                >
                  📊 导出评估报告 (.md)
                </button>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="ac-btn-ghost text-xs px-3 py-1.5"
                  >
                    关闭
                  </button>
                  {canGrade && (
                    <button
                      type="submit"
                      disabled={pending || milestones.length === 0}
                      className="rounded-lg bg-purple-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                    >
                      {pending ? "提交中…" : "提交打分与评审"}
                    </button>
                  )}
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
