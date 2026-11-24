import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { HostMessage, ProjectSnapshot, SessionMemoryViewState, TaskDetail, WebviewMessage } from "../../src/types";
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
  const [sessionMemory, setSessionMemory] = useState<SessionMemoryViewState | null>(null);
  const [hookAlerts, setHookAlerts] = useState<Array<{ id: string; occurredAt: string; detail: string }>>([]);
  const [hookAlertError, setHookAlertError] = useState<string | null>(null);
  const [codexHookConfigured, setCodexHookConfigured] = useState(false);

  useEffect(() => {
    const listener = (event: MessageEvent<HostMessage>) => {
      const message = event.data;
      if (message.type === "codexHookStatus") setCodexHookConfigured(message.configured);
      if (message.type === "codexHookAlerts") {
        setHookAlerts(message.alerts);
        setHookAlertError(message.error);
      }
      if (message.type === "snapshot") {
        setSnapshot(message.snapshot);
        setSelectedTaskId((current) => message.snapshot.tasks.some((task) => task.id === current) ? current : null);
          if (!message.snapshot.tasks.some((task) => task.id === selectedTaskRef.current)) {
          selectedTaskRef.current = null;
          setSessionMemory(null);
        }
        if (message.snapshot.state === "ready" && selectedTaskRef.current && message.snapshot.tasks.some((task) => task.id === selectedTaskRef.current)) {
          const taskId = selectedTaskRef.current;
          api.postMessage({ type: "openTask", taskId });
        }
      }
      if (message.type === "sessionMemoryState" && selectedTaskRef.current === message.state.taskId) {
        setSessionMemory(message.state);
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
    setSessionMemory(null);
    api.postMessage({ type: "openTask", taskId });
  };
  const selected = selectedTaskId ? details[selectedTaskId] : undefined;
  const selectedDetail = selected && !("error" in selected) ? selected : null;

  return (
    <main>
      <header className="title-row">
        <div><small>AGILECAMPUS / 项目</small><h1>{snapshot?.projectName ?? "项目工作台"}</h1></div>
        <button className="icon-button" title="刷新项目任务" aria-label="刷新" onClick={() => api.postMessage({ type: "refresh" })}>↻</button>
      </header>

      {hookAlertError ? <p className="session-error" role="alert">无法读取本机 Hook 故障提示：{hookAlertError}</p> : null}
      {hookAlerts.map((alert) => <div className="session-error" role="alert" key={alert.id}>
        <span>Codex Hook 未保存一条超出 8 MiB 限制的输入（{new Date(alert.occurredAt).toLocaleString()}）：{alert.detail}</span>
        <button className="text-button" onClick={() => api.postMessage({ type: "dismissHookAlert", alertId: alert.id })}>标记已处理</button>
      </div>)}

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

        <section className="session-section" aria-label="会话记录">
          <div className="session-heading">
            <strong>会话记录</strong>
            <div className="session-actions">
              <button className="text-button" disabled={!selectedTaskId || sessionMemory?.status === "loading"}
                onClick={() => selectedTaskId && api.postMessage({ type: "bindSession", taskId: selectedTaskId })}>
                {sessionMemory?.status === "loading" ? "处理中…" : sessionMemory?.sessions.length ? "关联另一会话" : "关联会话"}
              </button>
              {selectedTaskId ? <button className="text-button" aria-label="刷新会话记录状态" onClick={() => api.postMessage({ type: "refreshSessionMemory", taskId: selectedTaskId })}>检查</button> : null}
              {codexHookConfigured ? <button className="text-button" onClick={() => api.postMessage({ type: "disableCodexCapture" })}>禁用本机 Hook</button> : null}
            </div>
          </div>
          {!selectedTaskId ? <p className="muted">先从上方任务列表选择任务。</p> : null}
          {selectedTaskId && (!sessionMemory || sessionMemory.taskId !== selectedTaskId) ? <p className="muted">正在读取本机记录状态…</p> : null}
          {sessionMemory?.taskId === selectedTaskId ? <>
            {sessionMemory.detail ? <p className={sessionMemory.status === "error" || sessionMemory.status === "partial" ? "session-error" : "muted"} role={sessionMemory.status === "error" ? "alert" : "status"}>{sessionMemory.detail}</p> : null}
            {sessionMemory.sessions.length ? <div className="session-list">
              {sessionMemory.sessions.map((session) => <div className="session-row" key={session.sessionKey}>
                <div className="session-meta">
                  <div className="session-row-main"><strong>{session.provider === "codex" ? "Codex" : "Claude Code"}</strong><span>{sessionStatusLabel(session.recording, session.hookConfigured, session.eventCount, Boolean(session.hasGaps), session.captureFailures ?? [])}</span></div>
                  <span>{session.eventCount} 条本机事件{session.lastSavedAt ? ` · 最近落盘 ${new Date(session.lastSavedAt).toLocaleString()}` : ""}</span>
                  {session.captureFailures?.map((failure, index) => <span className="session-error" key={`${failure.occurredAt}-${index}`}>采集失败 {new Date(failure.occurredAt).toLocaleString()}：{failure.detail}</span>)}
                  {!session.captureFailures?.length && session.hasGaps ? <span className="session-error">存在记录缺口，查看记录中的“记录缺口”事件。</span> : null}
                </div>
                <div className="session-actions">
                  <button className="text-button" onClick={() => api.postMessage({ type: "openSessionRecord", taskId: selectedTaskId!, sessionKey: session.sessionKey })}>查看记录</button>
                  {session.recording && !session.hookConfigured ? <button className="text-button" onClick={() => api.postMessage({ type: "enableCodexCapture", taskId: selectedTaskId! })}>启用本机记录</button> : null}
                  {session.recording ? <button className="text-button" onClick={() => api.postMessage({ type: "stopSessionCapture", taskId: selectedTaskId!, sessionKey: session.sessionKey })}>停止记录</button> : null}
                </div>
              </div>)}
            </div> : null}
          </> : null}
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
          </> : null}
          {!selectedDetail && !(selected && "error" in selected) ? (
            snapshot?.state === "error"
              ? <p className="error-state" role="alert">项目刷新失败，任务详情暂不可用。请重试项目刷新。</p>
              : <p className="muted">正在读取任务详情…</p>
          ) : null}
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

function sessionStatusLabel(recording: boolean, hookConfigured: boolean, eventCount: number, hasGaps: boolean, captureFailures: Array<{ occurredAt: string; detail: string }>): string {
  if (captureFailures.length || hasGaps) return "部分记录 · 需检查";
  if (!recording) return "已停止 · 历史保留";
  if (!hookConfigured) return "已关联 · 记录未启用";
  if (eventCount === 0) return "Hook 已配置 · 等待新记录";
  return "已有 Hook 事件落盘";
}

createRoot(document.getElementById("root")!).render(<App />);
