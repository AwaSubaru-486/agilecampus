import type { NormalizedEventV1 } from "../../../shared/session-memory/types";

declare function acquireVsCodeApi(): { postMessage(message: { type: "ready" | "loadOlder" | "loadLatest" }): void };
const api = acquireVsCodeApi();
const list = document.querySelector<HTMLElement>("#record-list")!;
const status = document.querySelector<HTMLElement>("#record-status")!;
const olderButton = document.querySelector<HTMLButtonElement>("#load-older")!;
const newButton = document.querySelector<HTMLButtonElement>("#new-events")!;
let total = 0;
let eventCount = 0;

document.querySelector("#refresh-records")?.addEventListener("click", () => api.postMessage({ type: "loadLatest" }));
olderButton.addEventListener("click", () => { olderButton.disabled = true; api.postMessage({ type: "loadOlder" }); });
newButton.addEventListener("click", () => { newButton.hidden = true; api.postMessage({ type: "loadLatest" }); });

window.addEventListener("message", (message: MessageEvent) => {
  const data = message.data as Record<string, unknown>;
  if (data.type === "error") {
    status.textContent = typeof data.message === "string" ? data.message : "读取本地会话记录失败";
    status.classList.add("record-error");
    if (data.operation === "older") olderButton.disabled = false;
    return;
  }
  if (data.type === "newEvents") {
    const count = typeof data.count === "number" ? data.count : 0;
    newButton.textContent = `${count} 条新记录 · 查看最新`;
    newButton.hidden = count <= 0;
    return;
  }
  if (data.type !== "page" || !Array.isArray(data.events)) return;
  const events = data.events as NormalizedEventV1[];
  const mode = data.mode === "prepend" ? "prepend" : "replace";
  const previousHeight = document.documentElement.scrollHeight;
  const previousTop = document.documentElement.scrollTop;
  if (mode === "replace") list.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const event of events) fragment.append(createEvent(event));
  if (mode === "prepend") list.prepend(fragment); else list.append(fragment);
  total = typeof data.total === "number" ? data.total : total;
  eventCount = list.querySelectorAll(".record-event").length;
  olderButton.hidden = data.hasOlder !== true;
  olderButton.disabled = false;
  const first = Number(list.querySelector<HTMLElement>(".record-event")?.dataset.sequence ?? 0);
  const last = Number(list.querySelectorAll<HTMLElement>(".record-event").item(eventCount - 1)?.dataset.sequence ?? 0);
  status.textContent = total === 0 ? "本机尚无事件。需要 Codex 审查并信任 Hook，之后产生的新事件才会记录。" : `显示第 ${first}–${last} 条，共 ${total} 条本机事件。`;
  status.classList.remove("record-error");
  newButton.hidden = true;
  if (mode === "prepend") document.documentElement.scrollTop = previousTop + (document.documentElement.scrollHeight - previousHeight);
  if (mode === "replace") document.documentElement.scrollTop = document.documentElement.scrollHeight;
});

api.postMessage({ type: "ready" });

function createEvent(event: NormalizedEventV1): HTMLElement {
  const article = document.createElement("article");
  article.className = `record-event record-${event.kind}`;
  article.dataset.sequence = String(event.sequence);
  const heading = document.createElement("header");
  const kind = document.createElement("strong");
  kind.textContent = kindLabel(event.kind);
  const sequence = document.createElement("span");
  sequence.textContent = `#${event.sequence}`;
  heading.append(kind, sequence);
  const timestamp = document.createElement("time");
  timestamp.textContent = event.timestamp ? new Date(event.timestamp).toLocaleString() : "来源未提供时间";
  heading.append(timestamp);
  article.append(heading);

  const body = document.createElement("pre");
  body.textContent = event.text;
  if (event.kind === "tool_call" || event.kind === "tool_result") {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = event.kind === "tool_call" ? `工具输入${event.command ? ` · ${event.command}` : ""}` : "工具输出";
    details.append(summary, body);
    article.append(details);
  } else article.append(body);
  return article;
}

function kindLabel(kind: NormalizedEventV1["kind"]): string {
  return ({ user: "用户", assistant: "Agent", tool_call: "工具调用", tool_result: "工具结果", git_snapshot: "代码状态", gap: "记录缺口" })[kind];
}
