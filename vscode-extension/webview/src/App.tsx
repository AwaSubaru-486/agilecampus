import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProjectSnapshot, WebviewMessage } from "../../src/types";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };

const api = acquireVsCodeApi();

function App() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  useEffect(() => {
    const listener = (event: MessageEvent<{ type: "snapshot"; snapshot: ProjectSnapshot }>) => {
      if (event.data.type === "snapshot") setSnapshot(event.data.snapshot);
    };
    window.addEventListener("message", listener);
    api.postMessage({ type: "refresh" });
    return () => window.removeEventListener("message", listener);
  }, []);

  return (
    <main>
      <header className="title-row"><div><small>AGILECAMPUS / 现场</small><h1>{snapshot?.projectName ?? "加载中"}</h1></div><button onClick={() => api.postMessage({ type: "refresh" })}>刷新</button></header>
      <section className="context"><span>仓库</span><strong>{snapshot?.repository ?? "未关联"}</strong><span>分支</span><strong>{snapshot?.currentBranch ?? "—"}</strong></section>
      <section><div className="section-title"><span>我的任务</span><span>{snapshot?.myTasks.length ?? 0}</span></div>{snapshot?.myTasks.length ? snapshot.myTasks.map((task) => <button className="task" key={task.id} onClick={() => api.postMessage({ type: "continueAiWork", taskId: task.id })}><strong>{task.title}</strong><small>{task.status}{task.dueDate ? ` · ${task.dueDate}` : ""}</small></button>) : <p className="empty">先在网页端关联项目，侧栏会显示任务和 AI 接力。</p>}</section>
      <footer><button onClick={() => api.postMessage({ type: "openProject" })}>打开网页端</button><button onClick={() => api.postMessage({ type: "reportBlocker" })}>报告卡住</button></footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
