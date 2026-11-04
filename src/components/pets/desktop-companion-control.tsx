"use client";
import { useCallback, useEffect, useState } from "react";
import { launchDesktopClient } from "@/lib/pets/launch-desktop-client";

export function DesktopCompanionControl() {
  const [status, setStatus] = useState({ connected: false, status: "offline" });
  const [launch, setLaunch] = useState<{ url: string; expiresAt: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/home/desktop", { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json(); setStatus(result);
      if (result.connected) setLaunch(null);
    } catch { /* A polling failure must not clear or misreport the actual client state. */ }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    const onVisibility = () => { if (!document.hidden) void refresh(); };
    const initial = setTimeout(() => void refresh(), 0);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { clearInterval(timer); clearTimeout(initial); document.removeEventListener("visibilitychange", onVisibility); };
  }, [refresh]);
  async function operate(operation: "connect" | "show" | "hide" | "disconnect") {
    setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/home/desktop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "暂时无法开启桌面陪伴");
      if (operation === "connect") {
        setLaunch({ url: result.launchUrl, expiresAt: Date.parse(result.expiresAt) });
        launchDesktopClient(result.launchUrl);
        setMessage("已发起打开桌宠程序。如浏览器询问，请允许打开；客户端确认连接后会自动更新状态。没有弹出时可点下方按钮重试。");
      }
      else setMessage(operation === "disconnect" ? "已撤销桌面连接。" : "请求已发送，正在等待客户端响应。");
      await refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败，请稍后重试"); }
    finally { setPending(false); }
  }
  function openOrConnect() {
    if (status.connected) { void operate("show"); return; }
    if (launch && Date.now() < launch.expiresAt) {
      try { launchDesktopClient(launch.url); setMessage("已重新发起打开。请允许浏览器打开桌宠程序，并在客户端确认连接。"); }
      catch (error) { setMessage(error instanceof Error ? error.message : "暂时无法打开桌宠"); }
      return;
    }
    void operate("connect");
  }
  return <section aria-label="桌面陪伴" className="flex flex-col gap-3 border-t border-stroke pt-4">
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-ink">桌面陪伴</h4><span className="text-[11px] text-ink-3">{status.connected ? status.status === "hidden" ? "已连接，暂时隐藏" : "桌宠正在运行" : "尚未连接"}</span></div>
    <p className="text-xs leading-6 text-ink-3">最小化或关闭网页后，桌宠仍可留在桌面。</p>
    <button className="ac-btn justify-center text-xs" disabled={pending} onClick={openOrConnect}>{pending ? "请稍等…" : status.connected ? "找到桌宠" : launch ? "再次打开桌宠" : "开启桌面陪伴"}</button>
    {launch && <a className="ac-btn-ghost justify-center text-xs" href={launch.url} onClick={event => { if (Date.now() > launch.expiresAt) { event.preventDefault(); setLaunch(null); setMessage("连接邀请已过期，请重新开启。"); } }}>打开桌宠程序 ↗</a>}
    {status.connected && <div className="flex justify-between gap-3 text-xs text-ink-3"><button disabled={pending} onClick={() => operate("hide")}>暂时隐藏</button><button disabled={pending} onClick={() => operate("disconnect")}>断开连接</button></div>}
    {message && <p role="status" className="text-xs leading-6 text-ink-2">{message}</p>}
    <details className="text-xs leading-6 text-ink-3"><summary className="cursor-pointer">首次使用与下载</summary><p className="mt-2">首次解压后运行一次 AgileCampusPet.exe，完成网页唤起注册。之后可直接在这里打开；若移动了程序目录，请在新目录再运行一次。浏览器询问时允许打开外部应用，隐藏后可从系统托盘找回。</p><a className="mt-2 inline-block text-signal underline underline-offset-4" href="/api/home/desktop/download">下载 Windows 客户端</a></details>
  </section>;
}
