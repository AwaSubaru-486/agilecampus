"use client";

import { useState } from "react";

// 「用 AI 解释」按钮。
//
// 刻意做成按需触发：面板的确定性内容（数字、任务名、谁来做）无论有没有密钥、
// 断不断网都照常完整可用。AI 只是锦上添花，且失败时必须给出可读的提示，
// 不能留一片空白——那会让人以为面板坏了。
export function HealthNarrator({ projectId }: { projectId: string }) {
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function explain() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/health-narrative`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "暂时生成不了综述，稍后再试");
      } else {
        setText(data.narrative ?? "");
      }
    } catch {
      setError("网络不通，综述暂时生成不了。上面的条目不受影响。");
    } finally {
      setLoading(false);
    }
  }

  if (text) {
    return (
      <div className="ac-card border-primary/20 bg-primary-soft/30 p-4">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-primary">AI 综述</p>
        <p className="mt-2 text-sm leading-6 text-ink">{text}</p>
        <p className="mt-2 text-[11px] text-ink-faint">
          这段只是把上面的条目串起来。数字、任务名与责任人以上方卡片为准。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={explain} disabled={loading} className="ac-btn-ghost text-xs">
        {loading ? "正在梳理…" : "用 AI 串一遍"}
      </button>
      {error && (
        <p aria-live="polite" className="text-xs text-ink-faint">
          {error}
        </p>
      )}
    </div>
  );
}
