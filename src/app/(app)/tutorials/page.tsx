"use client";

import Link from "next/link";
import { useTutorials } from "./tutorial-provider";
import type { CourseId } from "@/lib/tutorials/catalog";

export default function TutorialsPage() {
  const { projects, project, courses, progress, pending, error, selectProject, start } = useTutorials();
  const roleName = project?.role === "admin" ? "组长" : project?.role === "teacher" ? "导师" : "组员";
  const groups = [...new Set(courses.slice(1).map((course) => course.category))];
  return <div data-tour="tutorial-directory" className="mx-auto max-w-5xl space-y-8 pb-12">
    <header className="flex flex-wrap items-end justify-between gap-5 border-b border-stroke pb-5">
      <div><p className="text-xs font-semibold tracking-widest text-signal">LEARN BY DOING</p><h1 className="mt-2 text-3xl font-semibold text-ink">新手教程</h1><p className="mt-2 text-sm text-ink-2">点亮真实入口，亲手完成操作。随时暂停，随时回来。</p></div>
      {projects.length > 0 && <label className="text-xs text-ink-3">练习项目，{roleName}<select aria-label="教程练习项目" className="ac-field mt-2 block max-w-full sm:w-72" value={project?.id ?? ""} onChange={(event) => selectProject(event.target.value)}><option value="" disabled>选择练习项目</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    </header>
    {!project && <div className="rounded-xl border border-stroke bg-panel p-4 text-sm leading-6 text-ink-2">先学习通用入口。<Link href="/teams" className="ml-2 text-signal underline">创建或加入团队</Link>，拥有项目后即可学习任务、迭代和项目协作。</div>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <section className="relative overflow-hidden rounded-2xl border border-signal/25 bg-panel p-6 sm:p-8">
      <div className="absolute -right-10 -top-10 size-52 rounded-full bg-signal/10 blur-3xl" aria-hidden />
      <p className="text-xs font-semibold text-signal">推荐起点，{courses[0].steps.length} 步，可以随时暂停</p>
      <h2 className="mt-3 text-2xl font-semibold text-ink">走一遍完整工作流程</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-2">{project ? `按${roleName}的分工安排路线，从团队和任务到协作、验收与工具连接。` : "从今日待办、团队入口开始，熟悉基础功能，再进入项目学习。"}点击与填写会给出即时反馈；生成、发布和发送仍由你按需确认。</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button disabled={pending} className="ac-btn" onClick={() => void start("welcome")}>{progress.completed.includes("welcome") ? "重走完整教程 →" : "开始完整教程 →"}</button>
        {progress.active && <button disabled={pending} className="ac-btn-ghost" onClick={() => void start(progress.active!.courseId as CourseId, true)}>继续上次：{courses.find((course) => course.id === progress.active?.courseId)?.title}，第 {progress.active.step + 1} 步</button>}
        {progress.completed.includes("welcome") && <span className="text-xs text-success">✓ 完整教程已完成</span>}
      </div>
    </section>
    {groups.map((group) => <section key={group} className="space-y-3">
      <h2 className="text-sm font-semibold text-ink">{group}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{courses.filter((course) => course.category === group).map((course) => {
        const locked = course.needsProject && !project || course.roles && (!project || !course.roles.includes(project.role));
        const completed = progress.completed.includes(course.id);
        return <article key={course.id} className={`flex flex-col rounded-xl border border-stroke bg-panel p-5 ${locked ? "opacity-65" : ""}`}>
          <div className="flex items-start justify-between gap-2"><h3 className="font-semibold text-ink">{course.title}</h3>{completed && <span className="text-xs text-success">✓ 已完成</span>}</div>
          <p className="mt-2 flex-1 text-xs leading-5 text-ink-2">{course.description}</p>
          <div className="mt-4 flex items-center justify-between gap-2"><span className="text-[11px] text-ink-3">{locked ? !project ? "需要项目" : `适用：${course.roles?.map((role) => role === "admin" ? "组长" : role === "teacher" ? "导师" : "组员").join(" / ")}` : `${course.steps.length} 个互动步骤`}</span><button disabled={pending || Boolean(locked)} className="ac-btn-ghost" onClick={() => void start(course.id)}>{completed ? "再练一次" : "开始学习"} →</button></div>
        </article>;
      })}</div>
    </section>)}
  </div>;
}
