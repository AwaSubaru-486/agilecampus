"use client";
import Link from "next/link";
import { useState } from "react";
import { useTutorials } from "./tutorial-provider";
import type { CourseId } from "@/lib/tutorials/catalog";
import { WorkspaceIcon } from "@/components/workspace-icon";

export default function TutorialsPage() {
  const {
    projects,
    project,
    showcase,
    courses,
    progress,
    pending,
    error,
    selectProject,
    start,
  } = useTutorials();
  const roleName =
    project?.role === "admin"
      ? "组长"
      : project?.role === "teacher"
        ? "老师"
        : "组员";
  const groups = [...new Set(courses.slice(1).map((c) => c.category))];
  const [category, setCategory] = useState("任务流程");
  const [query, setQuery] = useState("");
  const [otherRoles, setOtherRoles] = useState(false);
  const locked = (course: (typeof courses)[number]) =>
    Boolean(
      (course.needsProject && !project) ||
        (course.roles && (!project || !course.roles.includes(project.role))),
    );
  const matched = courses
    .slice(1)
    .filter(
      (c) =>
        (query.trim()
          ? (c.title + c.description).includes(query.trim())
          : c.category === category) &&
        (otherRoles || !locked(c)),
    );
  return (
    <div data-tour="tutorial-directory" className="mx-auto max-w-5xl pb-10">
      <header className="ac-page-header flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1>新手教程</h1>
          <p>跟着汪汪队的敏捷开发平台，认识从分工到交付的完整流程。</p>
        </div>
        {projects.length > 0 && (
          <label className="text-xs text-ink-3">
            功能课程展示项目 · {roleName}
            <select
              aria-label="教程展示项目"
              className="ac-field mt-2 block max-w-full sm:w-64"
              value={project?.id ?? ""}
              onChange={(e) => selectProject(e.target.value)}
            >
              <option value="" disabled>
                选择展示项目
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.teamName ? `${p.teamName} · ` : ""}{p.name}（{p.taskTotal ?? 0} 项任务）
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {!showcase && (
        <p className="mb-5 rounded-xl bg-signal-soft p-5 text-sm text-ink-2">
          当前账号尚未加入汪汪队，加入后即可查看展示导览。下方功能课程也可使用你有权限的其他项目。
          <Link href="/teams" className="ml-2 text-signal underline">
            查看我的团队
          </Link>
          。
        </p>
      )}
      {error && (
        <p role="alert" className="mb-5 text-sm text-risk">
          {error}
        </p>
      )}
      <section data-tour="tutorial-showcase" className="ac-tutorial-feature">
        <div className="ac-tutorial-symbol">
          <WorkspaceIcon name="tutorials" className="size-10" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-signal">
            汪汪队 · 项目导览，
            {courses[0].steps.length} 个互动步骤
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-ink">
            用敏捷开发平台看懂团队协作
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-7 text-ink-2">
            从现有成员和任务出发，了解组长如何下派任务、组员如何交付、老师如何复核。查看按阶段折叠的任务列表，在时间线点开详情，再认识 AI 项目对话和成果记录。
          </p>
          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            {[['01', '成员与分工', '先看角色，再看负责人'], ['02', '任务与时间线', '展开阶段，点开任务详情'], ['03', '协作与验收', '认识对话、交付和复核']].map(([number, title, detail]) => (
              <div key={number} className="rounded-xl border border-stroke bg-panel p-4">
                <span className="text-xs font-semibold text-signal">{number}</span>
                <h3 className="mt-2 font-semibold text-ink">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-ink-3">{detail}</p>
              </div>
            ))}
          </div>
          {showcase && <p className="mt-4 text-xs text-ink-3">展示项目：{showcase.teamName} / {showcase.name}，共 {showcase.taskTotal ?? 0} 项任务，按你的真实角色安排教程。</p>}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              className="ac-btn"
              disabled={pending || !showcase}
              onClick={() => void start("welcome")}
            >
              {pending ? "正在准备导览…" : progress.completed.includes("welcome") ? "重新查看项目导览 →" : "开始项目导览 →"}
            </button>
            {progress.journey?.teamId && (
              <p className="w-full text-xs text-ink-3">
                查看页面即可继续学习。教程进度会保存，随时暂停后可从上次的位置继续。
              </p>
            )}
            {progress.active && (
              <button
                className="ac-btn-ghost"
                disabled={pending}
                onClick={() =>
                  void start(progress.active!.courseId as CourseId, true)
                }
              >
                继续上次教程 →
              </button>
            )}
            {progress.completed.includes("welcome") && (
              <span className="text-xs text-success">✓ 已完成</span>
            )}
          </div>
        </div>
      </section>
      <section className="mt-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">只学你现在需要的</h2>
            <p className="mt-2 text-xs text-ink-3">
              按协作场景查找，不必重走全部教程。
            </p>
          </div>
          <input
            aria-label="搜索功能教程"
            placeholder="搜索功能，如任务、验收…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="ac-field max-w-xs text-sm"
          />
        </div>
        <nav aria-label="教程分类" className="mb-6 flex flex-wrap gap-2">
          {groups.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={category === g && !query}
              onClick={() => {
                setCategory(g);
                setQuery("");
              }}
              className={
                "rounded-lg px-4 py-2.5 text-xs " +
                (category === g && !query
                  ? "bg-signal-soft font-semibold text-signal"
                  : "bg-panel text-ink-3 hover:text-ink")
              }
            >
              {g}
            </button>
          ))}
        </nav>
        <div className="grid gap-4 sm:grid-cols-2">
          {matched.map((c) => (
            <article key={c.id} className="ac-focus-card flex flex-col p-6">
              <div className="flex items-start justify-between gap-4">
                <h3 className="font-semibold text-ink">{c.title}</h3>
                {progress.completed.includes(c.id) && (
                  <span className="shrink-0 text-[11px] text-success">
                    ✓ 已学习
                  </span>
                )}
              </div>
              <p className="mb-6 mt-3 flex-1 text-xs leading-6 text-ink-3">
                {c.description}
              </p>
              <div className="flex items-center justify-between border-t border-stroke pt-4">
                <span className="text-[11px] text-ink-3">
                  {locked(c)
                    ? !project
                      ? "需要项目"
                      : "适用于其他角色"
                    : c.steps.length + " 个互动步骤"}
                </span>
                <button
                  className="text-xs font-semibold text-signal disabled:text-ink-3"
                  disabled={pending || locked(c)}
                  onClick={() => void start(c.id)}
                >
                  {progress.completed.includes(c.id) ? "再练一次" : "开始学习"}{" "}
                  →
                </button>
              </div>
            </article>
          ))}
        </div>
        {!matched.length && (
          <p className="rounded-xl border border-dashed border-stroke p-8 text-center text-sm text-ink-3">
            {query
              ? "没有找到相关教程，试试其他关键词。"
              : "当前角色暂时没有这一类教程，可以切换分类。"}
          </p>
        )}
        <label className="mt-6 flex items-center gap-2 text-xs text-ink-3">
          <input
            type="checkbox"
            checked={otherRoles}
            onChange={(e) => setOtherRoles(e.target.checked)}
          />
          查看其他角色的课程
        </label>
      </section>
    </div>
  );
}
