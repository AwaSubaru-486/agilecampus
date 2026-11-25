"use client";

import Link from "next/link";
import { useState } from "react";
import { useTutorials } from "./tutorial-provider";
import { WELCOME_CHAPTERS, welcomeMinutes } from "@/lib/tutorials/example-flow";
import { WorkspaceIcon } from "@/components/workspace-icon";
import s from "./tutorials.module.css";

const ROLE_NAMES = { admin: "组长", student: "组员", teacher: "老师" };

export default function TutorialsPage() {
  const { projects, project, showcase, courses, progress, pending, error, selectProject, start } = useTutorials();
  const [welcome, ...lessons] = courses;
  const groups = [...new Set(lessons.map(course => course.category))];
  const [category, setCategory] = useState(project ? "任务流程" : "开始协作");
  const [query, setQuery] = useState("");
  const [otherRoles, setOtherRoles] = useState(false);
  const search = query.trim();
  const locked = (course: (typeof lessons)[number]) =>
    course.needsProject && !project || course.roles && (!project || !course.roles.includes(project.role));
  const matched = lessons.filter(course =>
    (search ? (course.title + course.description).includes(search) : course.category === category)
    && (otherRoles || !locked(course))
  );
  const resumeWelcome = progress.active?.courseId === "welcome" && progress.active.projectId === showcase?.id;
  const activeChapter = resumeWelcome ? welcome.steps[progress.active!.step]?.chapter : undefined;
  const completed = progress.completed.includes("welcome");
  const activeLesson = lessons.find(course => course.id === progress.active?.courseId);

  return (
    <div data-tour="tutorial-directory" className={s.page}>
      <header className={s.header}>
        <h1>新手教程</h1>
        <a href="#tutorial-lessons">按功能学习 <span aria-hidden>↓</span></a>
      </header>

      {error && <p role="alert" className="mb-4 text-sm text-risk">{error}</p>}

      <section data-tour="tutorial-showcase" aria-labelledby="welcome-title" className={s.hero}>
        <div className={s.intro}>
          <p className={s.kicker}><WorkspaceIcon name="tutorials" className="size-4" /> 项目导览</p>
          <h2 id="welcome-title">敏捷开发平台</h2>
          <p className={s.lead}>从团队成员和分工开始，打开实际任务，沿时间线认识阶段与验收。最后看看这些成果怎样进入版本和复盘，再回目录按功能练习。</p>
          <p className={s.projectMeta}>
            <span>约 {welcomeMinutes(welcome.steps)} 分钟</span>
            <span>{WELCOME_CHAPTERS.length} 章 {welcome.steps.length} 步</span>
            {showcase && <span>{ROLE_NAMES[showcase.role]}视角</span>}
          </p>
          {showcase ? (
            <>
              <div className={s.actions}>
                <button className={s.start} disabled={pending} onClick={() => void start("welcome", resumeWelcome)}>
                  {pending ? "正在准备…" : resumeWelcome ? "继续项目导览" : completed ? "重新查看导览" : "开始项目导览"}
                  <WorkspaceIcon name="arrow" className="size-4" />
                </button>
                <Link href={`/projects/${showcase.id}`} className={s.open}>直接打开项目</Link>
              </div>
              <p className={s.progressNote}>
                {resumeWelcome ? `已保存到第 ${progress.active!.step + 1} 步` : completed ? "已完成项目导览" : "可随时暂停，之后从原步骤继续。"}
              </p>
            </>
          ) : (
            <div className={s.unavailable}>
              <p>当前账号暂时无法访问这个演示项目。</p>
              <Link href="/teams" className={s.open}>查看我的团队 <span aria-hidden>→</span></Link>
            </div>
          )}
        </div>

        <div className={s.itinerary}>
          <h3>导览路线</h3>
          <ol>
            {WELCOME_CHAPTERS.map((chapter, index) => (
              <li key={chapter.title} aria-current={activeChapter === index ? "step" : undefined}>
                <span className={s.marker} aria-hidden>{index + 1}</span>
                <div>
                  <h4>{chapter.title}</h4>
                  <p>{chapter.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="tutorial-lessons" aria-labelledby="tutorial-lessons-title" className={s.lessons}>
        <div className={s.lessonHeader}>
          <div>
            <h2 id="tutorial-lessons-title">按功能学习</h2>
            {activeLesson && <button className={s.resumeLesson} disabled={pending} onClick={() => void start(activeLesson.id, true)}>继续「{activeLesson.title}」 →</button>}
          </div>
          {projects.length > 0 && (
            <label className={s.projectPicker}>
              练习项目
              <select aria-label="教程展示项目" className="ac-field" value={project?.id ?? ""} onChange={event => selectProject(event.target.value)}>
                <option value="" disabled>选择项目</option>
                {projects.map(item => <option key={item.id} value={item.id}>{item.name}（{item.teamName || ROLE_NAMES[item.role]}）</option>)}
              </select>
            </label>
          )}
        </div>

        <div className={s.filters}>
          <nav aria-label="教程分类">
            {groups.map(group => (
              <button key={group} type="button" aria-pressed={category === group && !search} onClick={() => { setCategory(group); setQuery(""); }}>
                {group}
              </button>
            ))}
          </nav>
          <input type="search" aria-label="搜索功能教程" placeholder="搜索任务、验收等功能" value={query} onChange={event => setQuery(event.target.value)} className="ac-field" />
        </div>

        {matched.length > 0 ? (
          <div className={s.lessonGrid}>
            {matched.map(course => (
              <article key={course.id} className={s.lesson}>
                <div>
                  <h3>{course.title}</h3>
                  <p>{course.description}</p>
                </div>
                <div className={s.lessonFooter}>
                  <span>{locked(course) ? project ? "适用于其他角色" : "需要项目" : progress.completed.includes(course.id) ? "已学习" : `${course.steps.length} 步`}</span>
                  <button disabled={pending || Boolean(locked(course))} onClick={() => void start(course.id)} aria-label={`学习${course.title}`}>
                    {progress.completed.includes(course.id) ? "再练一次" : "开始学习"} <WorkspaceIcon name="arrow" className="size-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : <p className={s.empty}>{search ? "没有找到相关教程。" : "当前项目或角色暂无可学课程，可切换分类。"}</p>}
        <label className={s.roles}><input type="checkbox" checked={otherRoles} onChange={event => setOtherRoles(event.target.checked)} /> 查看其他角色的课程</label>
      </section>
    </div>
  );
}
