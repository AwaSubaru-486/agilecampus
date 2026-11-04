"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

export type PetPreset = "puppy" | "pacman" | "nailong" | "custom";

interface DeskPetConfig {
  preset: PetPreset;
  name: string;
  customImageUrl?: string;
  webPetVisible?: boolean;
}

interface TaskNotificationItem {
  id: string;
  projectId: string;
  projectName: string;
  taskId: string;
  taskTitle: string;
  sourceTaskId: string;
  sourceTitle: string;
  createdAt: string;
}

const PRESET_ASSETS: Record<PetPreset, { name: string; img: string; quote: string; icon: string }> = {
  puppy: {
    name: "线条小狗",
    img: "/desk-pet/puppy.png",
    quote: "汪汪！大耳朵甩甩，今天也要开开心心交付任务~ 🦴",
    icon: "🐶",
  },
  pacman: {
    name: "吃豆人",
    img: "/desk-pet/pacman.png",
    quote: "Waka-Waka！消灭 Bug 就像吃豆子一样爽快！🍒👻",
    icon: "🟡",
  },
  nailong: {
    name: "敏捷奶龙",
    img: "/desk-pet/nailong.png",
    quote: "呜呜~ 任务有点难嘛…抱抱我，一起冲刺交付好不好？💛🥺",
    icon: "🐉",
  },
  custom: {
    name: "自定义伙伴",
    img: "/desk-pet/puppy.png",
    quote: "你好呀！我是你的专属敏捷工作助手~ ✨",
    icon: "🎨",
  },
};

export function resolveAvatarUrl(url?: string): string {
  if (!url || typeof url !== "string") return "/desk-pet/puppy.png";
  const trimmed = url.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return "/desk-pet/puppy.png";

  // 1. 网络链接或 base64
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
    return trimmed;
  }

  // 2. 项目相对路径
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed;
  }

  // 3. 本地绝对路径 (如 C:\... 或 file:///... 或 /Users/...)
  return `/api/desktop-pet/image?path=${encodeURIComponent(trimmed)}`;
}

export function WebDeskPet() {
  const [visible, setVisible] = useState(true);
  const [config, setConfig] = useState<DeskPetConfig>({
    preset: "puppy",
    name: "线条小狗",
    customImageUrl: "",
    webPetVisible: true,
  });

  // 坐标位置 (相对于浏览器视口)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });
  const hasMovedRef = useRef(false);

  // 气泡对话状态
  const [bubble, setBubble] = useState<{
    show: boolean;
    title: string;
    text: string;
    allowReply: boolean;
    notifId?: string;
  }>({
    show: true,
    title: "👾 网页桌宠就绪",
    text: "汪！我是线条小狗，已常驻网页！按住我可以随意拖动位置~",
    allowReply: false,
  });
  const [replyInput, setReplyInput] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bubbleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 动画状态
  const [actionAnim, setActionAnim] = useState<"idle" | "jump" | "shake">("idle");
  const [hasAlert, setHasAlert] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // 已提醒的通知 ID 集合（避免重复弹出同一条通知）
  const handledNotifIdsRef = useRef<Set<string>>(new Set());

  // 1. 初始化读取本地持久化设置
  useEffect(() => {
    try {
      const savedConfig = localStorage.getItem("agilecampus.deskpet.config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        setConfig((prev) => ({ ...prev, ...parsed }));
        if (parsed.webPetVisible !== undefined) {
          setVisible(parsed.webPetVisible);
        }
      }
      const savedPos = localStorage.getItem("agilecampus.webpet.pos");
      if (savedPos) {
        const parsedPos = JSON.parse(savedPos);
        if (typeof parsedPos.x === "number" && typeof parsedPos.y === "number") {
          setPosition(parsedPos);
        }
      }
    } catch {}
  }, []);

  // 初始默认位置：居于视口右下方（避开右下角求助按钮）
  useEffect(() => {
    if (position === null && typeof window !== "undefined") {
      const defaultX = Math.max(20, window.innerWidth - 250);
      const defaultY = Math.max(40, window.innerHeight - 280);
      setPosition({ x: defaultX, y: defaultY });
    }
  }, [position]);

  // 气泡展示与定时隐藏控制
  const triggerBubble = useCallback((title: string, text: string, allowReply = false, notifId?: string, duration = 8000) => {
    setBubble({
      show: true,
      title,
      text,
      allowReply,
      notifId,
    });
    if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    if (duration > 0) {
      bubbleTimerRef.current = setTimeout(() => {
        // 如果正在输入中或输入框有文字，则不强行关闭
        if (document.activeElement === inputRef.current || inputRef.current?.value.trim()) {
          return;
        }
        setBubble((b) => ({ ...b, show: false }));
      }, duration);
    }
  }, []);

  // 2. 外部自定义事件监听 (任务完成庆祝、逾期预警、居中呼回、形象/名称更新等)
  useEffect(() => {
    const handlePetEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (detail.type === "celebrate") {
        setActionAnim("jump");
        setShowConfetti(true);
        triggerBubble("🎉 任务完成庆祝！", detail.title ? `太棒啦！「${detail.title}」已顺利交付验收！` : "团队里程碑+1，向交付胜利冲刺！", false, undefined, 6000);
        setTimeout(() => {
          setActionAnim("idle");
          setShowConfetti(false);
        }, 2500);
      } else if (detail.type === "overdue") {
        setActionAnim("shake");
        setHasAlert(true);
        triggerBubble("⚠️ 任务即将逾期预警", detail.text || `任务「${detail.title || "敏捷任务"}」截止时间临近，请加紧推进或呼叫搭手！`, true, undefined, 8000);
        setTimeout(() => setActionAnim("idle"), 800);
      } else if (detail.type === "reset-pos") {
        const defaultX = Math.max(20, Math.round((window.innerWidth - 220) / 2));
        const defaultY = Math.max(40, Math.round((window.innerHeight - 250) / 2));
        setPosition({ x: defaultX, y: defaultY });
        setVisible(true);
        triggerBubble("👾 桌宠在此！", "主人，我回到了屏幕正中！随时待命~", false, undefined, 5000);
        try {
          localStorage.setItem("agilecampus.webpet.pos", JSON.stringify({ x: defaultX, y: defaultY }));
        } catch {}
      } else if (detail.type === "message") {
        triggerBubble(detail.title || "💬 团队消息", detail.text, true, detail.id, 9000);
      } else if (detail.type === "toggle-visibility") {
        setVisible(detail.visible !== undefined ? detail.visible : (v) => !v);
      } else if (detail.type === "switch-preset") {
        setConfig((c) => ({
          ...c,
          preset: detail.preset || c.preset,
          name: detail.name || c.name,
          customImageUrl: detail.customUrl !== undefined ? detail.customUrl : c.customImageUrl,
        }));
      } else if (detail.type === "rename") {
        if (detail.name) {
          setConfig((c) => ({ ...c, name: detail.name }));
          triggerBubble("✨ 桌宠新名字", `你好呀！以后我就是你的专属「${detail.name}」啦~`, false, undefined, 5000);
        }
      }
    };

    window.addEventListener("agilecampus:deskpet-event", handlePetEvent);
    return () => window.removeEventListener("agilecampus:deskpet-event", handlePetEvent);
  }, [triggerBubble]);

  // 3. 定时轮询网站新通知与互动事件
  useEffect(() => {
    const pollNotifsAndSync = async () => {
      try {
        // A. 轮询当前用户的通知列表
        const notifRes = await fetch("/api/notifications", { cache: "no-store" });
        if (notifRes.ok) {
          const notifs: TaskNotificationItem[] = await notifRes.json();
          if (Array.isArray(notifs) && notifs.length > 0) {
            const unhandled = notifs.find((n) => !handledNotifIdsRef.current.has(n.id));
            if (unhandled) {
              handledNotifIdsRef.current.add(unhandled.id);
              triggerBubble(
                `📬 任务通知：${unhandled.projectName}`,
                `「${unhandled.sourceTitle}」已验收通过，轮到你接棒负责「${unhandled.taskTitle}」啦！可在此直接回复确认~`,
                true,
                unhandled.id,
                15000
              );
            }
          }
        }

        // B. 轮询后端消费事件与预警
        const res = await fetch("/api/desktop-pet/sync", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();

        // 同步配置
        if (data.config) {
          if (
            (data.config.preset && data.config.preset !== config.preset) ||
            (data.config.name && data.config.name !== config.name) ||
            (data.config.customImageUrl && data.config.customImageUrl !== config.customImageUrl)
          ) {
            setConfig((c) => ({
              ...c,
              preset: data.config.preset || c.preset,
              name: data.config.name || c.name,
              customImageUrl: data.config.customImageUrl !== undefined ? data.config.customImageUrl : c.customImageUrl,
            }));
          }
        }

        // 消费事件队列
        if (data.events && data.events.length > 0) {
          for (const ev of data.events) {
            if (ev.type === "celebrate") {
              setActionAnim("jump");
              setShowConfetti(true);
              triggerBubble("🎉 任务完成庆祝！", `太棒啦！「${ev.title || "任务"}」已顺利交付验收！`, false, undefined, 6000);
              setTimeout(() => {
                setActionAnim("idle");
                setShowConfetti(false);
              }, 2500);
            } else if (ev.type === "overdue") {
              setActionAnim("shake");
              setHasAlert(true);
              triggerBubble("⚠️ 即将逾期警报", `紧急：${ev.title || "关键任务"} 截止时间已临近，请尽快推进！`, true, undefined, 8000);
              setTimeout(() => setActionAnim("idle"), 800);
            } else if (ev.type === "message") {
              triggerBubble(ev.title || "💬 网站通知", ev.text, true, ev.id, 9000);
            }
          }
        }
      } catch {}
    };

    void pollNotifsAndSync();
    const interval = setInterval(pollNotifsAndSync, 3500);
    return () => clearInterval(interval);
  }, [config.customImageUrl, config.name, config.preset, triggerBubble]);

  // 4. 鼠标拖拽交互
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("input")) {
      return;
    }
    setIsDragging(true);
    hasMovedRef.current = false;
    dragStartRef.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: position?.x ?? 0,
      startY: position?.y ?? 0,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.mouseX;
    const dy = e.clientY - dragStartRef.current.mouseY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMovedRef.current = true;
    }
    const nextX = Math.max(10, Math.min(window.innerWidth - 220, dragStartRef.current.startX + dx));
    const nextY = Math.max(10, Math.min(window.innerHeight - 250, dragStartRef.current.startY + dy));
    setPosition({ x: nextX, y: nextY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}

    // 如果只是轻击单击本体，触发宠物的萌萌台词
    if (!hasMovedRef.current) {
      const cur = PRESET_ASSETS[config.preset] || PRESET_ASSETS.puppy;
      const petDisplayName = config.name || cur.name;
      triggerBubble(`${cur.icon} ${petDisplayName}`, cur.quote, false, undefined, 5000);
    } else if (position) {
      try {
        localStorage.setItem("agilecampus.webpet.pos", JSON.stringify(position));
      } catch {}
    }
  };

  // 5. 提交回复并消去通知
  const submitReply = async (customText?: string) => {
    const text = (customText || replyInput).trim();
    if (!text || isReplying) return;
    setIsReplying(true);

    try {
      await fetch("/api/desktop-pet/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          notificationId: bubble.notifId,
        }),
      });

      if (bubble.notifId) {
        try {
          await fetch("/api/notifications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: bubble.notifId }),
          });
        } catch {}
      }

      setReplyInput("");
      triggerBubble("✅ 消息已回复并确认", `你的回复「${text}」已成功传达给团队！`, false, undefined, 4500);
    } catch {
      triggerBubble("⚠️ 发送提示", "网络异常，回复未能送达", false, undefined, 3000);
    } finally {
      setIsReplying(false);
    }
  };

  if (!visible || !position) return null;

  const currentAsset = PRESET_ASSETS[config.preset] || PRESET_ASSETS.puppy;
  const avatarRaw = config.preset === "custom" && config.customImageUrl ? config.customImageUrl : currentAsset.img;
  const avatarSrc = resolveAvatarUrl(avatarRaw);

  return (
    <div
      style={{
        transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      }}
      className="fixed top-0 left-0 z-[65] select-none flex flex-col items-center pointer-events-auto transition-transform duration-75 ease-out"
    >
      {/* 1. 对话气泡与快速回复框 */}
      {bubble.show && (
        <div className="relative mb-2 w-68 bg-white/95 text-slate-900 border-2 border-slate-900 rounded-2xl p-3 shadow-2xl backdrop-blur-xs animate-in fade-in zoom-in-95 duration-150">
          {/* 气泡标题与关闭按钮 */}
          <div className="flex items-center justify-between pb-1 mb-1 border-b border-slate-200">
            <span className="text-[11px] font-bold text-slate-600 flex items-center gap-1">
              <span>{bubble.title}</span>
            </span>
            <button
              type="button"
              onClick={() => setBubble((b) => ({ ...b, show: false }))}
              className="text-slate-400 hover:text-slate-800 text-xs font-bold px-1"
            >
              ✕
            </button>
          </div>

          {/* 气泡正文 */}
          <p className="text-xs text-slate-800 leading-relaxed font-medium">
            {bubble.text}
          </p>

          {/* 快捷回复与签收操作行 */}
          {bubble.allowReply && (
            <div className="mt-2 pt-2 border-t border-slate-200 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <input
                  ref={inputRef}
                  type="text"
                  value={replyInput}
                  onChange={(e) => setReplyInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void submitReply()}
                  placeholder="输入文字回复通知..."
                  className="flex-1 bg-slate-100 border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => submitReply()}
                  disabled={isReplying || !replyInput.trim()}
                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-all active:scale-95 disabled:opacity-40"
                >
                  {isReplying ? "发送…" : "回复"}
                </button>
              </div>

              {/* 快捷按钮 */}
              <div className="flex items-center gap-1.5 justify-end">
                <button
                  type="button"
                  onClick={() => submitReply("收到，马上处理！")}
                  disabled={isReplying}
                  className="text-[10px] px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border border-slate-200"
                >
                  收到，马上处理！
                </button>
                <button
                  type="button"
                  onClick={() => submitReply("已确认接棒")}
                  disabled={isReplying}
                  className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-medium border border-emerald-200"
                >
                  确认接棒
                </button>
              </div>
            </div>
          )}

          {/* 对话气泡向下小三角 */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[7px] border-l-transparent border-r-[7px] border-r-transparent border-t-[8px] border-t-slate-900" />
          <div className="absolute -bottom-[6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[7px] border-t-white" />
        </div>
      )}

      {/* 2. 纯像素角色立绘主体 (支持鼠标拖拽与点击互动) */}
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className={`relative cursor-grab active:cursor-grabbing p-1 group transition-transform ${
          actionAnim === "jump"
            ? "animate-bounce"
            : actionAnim === "shake"
            ? "animate-pulse"
            : "hover:scale-105"
        }`}
        title="按住鼠标左键可拖拽位置，点击可互动打招呼"
      >
        {/* 彩带烟花特效 */}
        {showConfetti && (
          <div className="absolute -top-6 left-1/2 -translate-x-1/2 text-2xl animate-ping pointer-events-none">
            🎉✨
          </div>
        )}

        {/* 逾期预警红点 */}
        {hasAlert && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              setHasAlert(false);
            }}
            className="absolute top-1 right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center font-bold text-xs shadow-md border-2 border-white animate-pulse cursor-pointer"
            title="点击消除提醒"
          >
            !
          </div>
        )}

        {/* 角色本体 (纯像素插值，绝不模糊) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatarSrc}
          alt={config.name || currentAsset.name}
          draggable={false}
          onError={(e) => {
            // 如果自定义图片读取失败，优雅回退到线条小狗
            (e.currentTarget as HTMLImageElement).src = "/desk-pet/puppy.png";
          }}
          className="w-28 h-28 object-contain [image-rendering:pixelated] drop-shadow-[0_8px_12px_rgba(0,0,0,0.35)] filter transition-all"
        />

        {/* 地面软阴影 */}
        <div className="w-16 h-3 bg-black/20 rounded-full mx-auto blur-[1.5px] mt-0.5 group-hover:scale-90 transition-transform" />
      </div>
    </div>
  );
}
