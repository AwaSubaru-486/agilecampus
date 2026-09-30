import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostMessage, ProjectSnapshot, TaskDetail, WebviewMessage } from "../../src/types";
import "./styles.css";

declare function acquireVsCodeApi(): { postMessage(message: WebviewMessage): void };
const api = acquireVsCodeApi();
const statusLabels: Record<string, string> = { todo: "待办", doing: "进行中", review: "待验收", done: "已完成" };
const statusLabel = (status: string) => statusLabels[status] ?? "未知状态";

function App() {
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const selectedTaskRef = useRef<string | null>(null);
  const [details, setDetails] = useState<Record<string, TaskDetail | { error: string }>>({});

  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
        setSelectedTaskId((current) => message.snapshot.tasks.some((task) => task.id === current) ? current : null);
        if (!message.snapshot.tasks.some((task) => task.id === selectedTaskRef.current)) selectedTaskRef.current = null;
        if (message.snapshot.state === "ready" && selectedTaskRef.current && message.snapshot.tasks.some((task) => task.id === selectedTaskRef.current)) {
          const taskId = selectedTaskRef.current;
          setDetails((current) => {
            const next = { ...current };
            delete next[taskId];
            return next;
          });
          api.postMessage({ type: "openTask", taskId });
        }
      }
      if (message.type === "taskDetail" && selectedTaskRef.current === message.taskId) {
        setDetails((current) => ({ ...current, [message.taskId]: message.detail }));
      }
      if (message.type === "taskDetailError" && selectedTaskRef.current === message.taskId) {
        setDetails((current) => ({ ...current, [message.taskId]: { error: message.error } }));
      }
    };
    window.addEventListener("message", listener);
    api.postMessage({ type: "refresh" });
    return () => window.removeEventListener("message", listener);
  }, []);

  const selectTask = (taskId: string) => {
    selectedTaskRef.current = taskId;
    setSelectedTaskId(taskId);
    if (!details[taskId]) api.postMessage({ type: "openTask", taskId });
  };
  const selected = selectedTaskId ? details[selectedTaskId] : undefined;
  const selectedDetail = selected && !("error" in selected) ? selected : null;

  return (
    <main>
      <header className="title-row">
        <div><small>AGILECAMPUS / 项目</small><h1>{snapshot?.projectName ?? "项目工作台"}</h1></div>
        <button className="icon-button" title="刷新项目任务" aria-label="刷新" onClick={() => api.postMessage({ type: "refresh" })}>↻</button>
      </header>

      {snapshot?.state === "disconnected" ? (
        <section className="connection-state">
          <p>{snapshot.error ?? "尚未连接 AgileCampus"}</p>
          <button onClick={() => api.postMessage({ type: "connect" })}>连接项目</button>
        </section>
      ) : null}

      {snapshot?.state === "loading" && snapshot.tasks.length === 0 ? <p className="muted">正在读取项目…</p> : null}
      {snapshot?.state === "error" ? (
        <div className="error-state" role="alert">
          <span>{snapshot.error}</span>
          {snapshot.updatedAt ? <small>上次同步：{new Date(snapshot.updatedAt).toLocaleString()}</small> : null}
          <button className="text-button" onClick={() => api.postMessage({ type: "refresh" })}>重试</button>
        </div>
      ) : null}

      {snapshot?.projectId ? <>
        <section className="project-context">
          <div><span>团队</span><strong>{snapshot.teamName ?? "—"}</strong></div>
          <div><span>工作区</span><strong>{snapshot.workspaceName ?? "未选择"}</strong></div>
          <div><span>仓库</span><strong>{snapshot.repository ?? "未检测到 Git 仓库"}</strong></div>
          <div><span>分支</span><strong>{snapshot.currentBranch ?? "—"}</strong></div>
        </section>

        <section className="tasks-section">
          <div className="section-title"><span>项目任务</span><span>{snapshot.tasks.length}</span></div>
          {snapshot.tasks.length ? <div className="task-list">
            {snapshot.tasks.map((task) => <button
              className={`task${selectedTaskId === task.id ? " selected" : ""}`}
              key={task.id}
              onClick={() => selectTask(task.id)}
            >
              <strong>{task.title}</strong>
              <span className="task-meta">{statusLabel(task.status)} · {task.assigneeName ?? "未分配"}{task.dueDate ? ` · ${task.dueDate}` : ""}</span>
            </button>)}
          </div> : snapshot.state === "ready" ? <p className="muted">此项目暂无任务。</p> : null}
        </section>

        {selectedTaskId ? <section className="task-detail">
          {selected && "error" in selected ? <div className="error-state" role="alert">{selected.error}<button className="text-button" onClick={() => { setDetails((current) => { const next = { ...current }; delete next[selectedTaskId]; return next; }); api.postMessage({ type: "openTask", taskId: selectedTaskId }); }}>重试</button></div> : null}
          {selectedDetail ? <>
            <div className="section-title"><span>交接要求</span><span>{statusLabel(selectedDetail.status)}</span></div>
            <dl>
              <dt>目标</dt><dd>{selectedDetail.handoffBrief || "未填写"}</dd>
              <dt>完成条件</dt><dd>{selectedDetail.doneCriteria.length ? <ul>{selectedDetail.doneCriteria.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : "未填写"}</dd>
              <dt>证据要求</dt><dd>{selectedDetail.requiredEvidence.length ? selectedDetail.requiredEvidence.join("、") : "未填写"}</dd>
              {selectedDetail.completionNote ? <><dt>提交说明</dt><dd>{selectedDetail.completionNote}</dd></> : null}
            </dl>
          </> : selected && !("error" in selected) ? null : <p className="muted">正在读取任务详情…</p>}
          <button className="text-button" onClick={() => api.postMessage({ type: "viewAgentWork", taskId: selectedTaskId })}>在网页中查看 Agent 工作</button>
        </section> : null}
      </> : null}

      <footer>
        <button className="text-button" onClick={() => api.postMessage({ type: "openProject" })}>打开网页端</button>
        {snapshot?.projectId ? <>
          <button className="text-button" onClick={() => api.postMessage({ type: "selectProject" })}>切换项目</button>
          <button className="text-button" onClick={() => api.postMessage({ type: "disconnect" })}>断开连接</button>
        </> : null}
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
