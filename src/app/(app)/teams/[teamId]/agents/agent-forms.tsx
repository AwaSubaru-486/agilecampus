"use client";

import { useActionState, useState } from "react";
import {
  deleteAgentAction,
  registerAgentAction,
  reissueTokenAction,
  type FormState,
  type RegisterState,
} from "./actions";

// 常见的 agent CLI。不锁死——「其他」允许填任意值，
// 因为新的 CLI 层出不穷，加一档不该改代码。
const PROVIDERS = [
  { value: "claude-code", label: "Claude Code" },
  { value: "codex", label: "Codex" },
  { value: "cursor", label: "Cursor" },
  { value: "gemini-cli", label: "Gemini CLI" },
  { value: "custom", label: "其他" },
];

function CopyableToken({ token, name }: { token: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-primary-soft/40 p-3">
      <p className="text-xs font-medium text-ink">
        「{name}」的接入令牌——<span className="text-high">只显示这一次</span>
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-surface px-2 py-1.5 text-[11px] text-ink-soft">
          {token}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(token);
            setCopied(true);
          }}
          className="ac-btn-ghost shrink-0 text-xs"
        >
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-ink-faint">
        贴进 agent 的环境变量：<code>AGILECAMPUS_TOKEN</code>，再设{" "}
        <code>AGILECAMPUS_URL</code> 指向本站。丢了就重发一枚，旧的需自行撤销。
      </p>
    </div>
  );
}

export function RegisterAgentForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(
    registerAgentAction,
    null,
  );

  const success = state && "ok" in state ? state : null;

  return (
    <div className="ac-card p-5">
      <h2 className="text-sm font-semibold text-ink">注册一个 AI 成员</h2>
      <p className="mt-1 text-xs leading-5 text-ink-faint">
        注册后它就能像人一样被指派任务：自己接活、汇报进展、卡住了会举手、
        做完交给你们验收。它干活，但不参与验收——判断做没做对是人的事。
      </p>

      <form key={success ? success.token : "new"} action={formAction} className="mt-4 space-y-3">
        <input type="hidden" name="teamId" value={teamId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-ink-faint">
            叫什么
            <input name="name" required placeholder="比如：小码" className="ac-field text-sm" />
          </label>
          <label className="space-y-1 text-xs text-ink-faint">
            跑在什么上
            <select name="provider" defaultValue="claude-code" className="ac-field text-sm">
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-ink-faint">
            会做什么（逗号分隔，选填）
            <input
              name="capabilities"
              placeholder="写接口，写测试"
              className="ac-field text-sm"
            />
          </label>
          <label className="space-y-1 text-xs text-ink-faint">
            同时最多跑几个任务
            <input
              type="number"
              name="maxConcurrent"
              min="1"
              max="10"
              defaultValue="1"
              className="ac-field text-sm"
            />
          </label>
        </div>

        {state && "error" in state && (
          <p aria-live="polite" className="text-xs text-high">
            {state.error}
          </p>
        )}
        {success && <CopyableToken token={success.token} name={success.name} />}

        <button disabled={pending} className="ac-btn text-sm">
          {pending ? "注册中…" : "注册"}
        </button>
      </form>
    </div>
  );
}

export function ReissueTokenButton({
  teamId,
  agentUserId,
  agentName,
}: {
  teamId: string;
  agentUserId: string;
  agentName: string;
}) {
  const [state, formAction, pending] = useActionState<RegisterState, FormData>(
    reissueTokenAction,
    null,
  );
  const success = state && "ok" in state ? state : null;

  return (
    <div>
      <form action={formAction} className="inline">
        <input type="hidden" name="teamId" value={teamId} />
        <input type="hidden" name="agentUserId" value={agentUserId} />
        <button disabled={pending} className="text-xs text-ink-faint hover:text-primary hover:underline">
          {pending ? "重发中…" : "重发令牌"}
        </button>
      </form>
      {state && "error" in state && (
        <p className="mt-1 text-xs text-high">{state.error}</p>
      )}
      {success && <CopyableToken token={success.token} name={agentName} />}
    </div>
  );
}

export function DeleteAgentButton({
  teamId,
  agentUserId,
  agentName,
}: {
  teamId: string;
  agentUserId: string;
  agentName: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    deleteAgentAction,
    null,
  );
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`移除「${agentName}」？它经手过的任务会变为未指派，但历史记录保留。`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="teamId" value={teamId} />
      <input type="hidden" name="agentUserId" value={agentUserId} />
      <button disabled={pending} className="text-xs text-ink-faint hover:text-high hover:underline">
        {pending ? "移除中…" : "移除"}
      </button>
      {state && "error" in state && <p className="mt-1 text-xs text-high">{state.error}</p>}
    </form>
  );
}
