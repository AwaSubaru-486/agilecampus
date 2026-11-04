"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";

export type PetPreset = "puppy" | "pacman" | "nailong" | "custom";

export interface DeskPetConfig {
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

// 每个预设宠物的多动作真实序列帧 (真正逐帧动作图片轮换，绝不拉伸变形)
export const PRESET_FRAMES: Record<PetPreset, { frames: string[]; actionNames: string[]; icons: string[] }> = {
  puppy: {
    frames: [
      "/desk-pet/frames/puppy_0.png", // 待机大圆眼
      "/desk-pet/frames/puppy_1.png", // 欢快摇尾巴
      "/desk-pet/frames/puppy_2.png", // 萌笑吐舌头
      "/desk-pet/frames/puppy_3.png", // 抬小爪爪打招呼
    ],
    actionNames: ["乖巧待机", "欢快摇尾", "萌笑吐舌", "抬爪招呼"],
    icons: ["🐶", "🦴", "👅", "🐾"],
  },
  pacman: {
    frames: [
      "/desk-pet/frames/pacman_0.png", // 张大嘴
      "/desk-pet/frames/pacman_1.png", // 半张嘴吃豆
      "/desk-pet/frames/pacman_2.png", // 闭嘴咀嚼
      "/desk-pet/frames/pacman_3.png", // 满足眯眼萌笑
    ],
    actionNames: ["张大嘴巴", "吞嚼小豆", "闭嘴回味", "满足萌笑"],
    icons: ["🟡", "🍒", "👻", "✨"],
  },
  nailong: {
    frames: [
      "/desk-pet/frames/nailong_0.png", // 委屈抹泪原画
      "/desk-pet/frames/nailong_1.png", // 委屈闭眼吸鼻涕
      "/desk-pet/frames/nailong_2.png", // 水汪汪抬头看主人
      "/desk-pet/frames/nailong_3.png", // 抿嘴吸鼻子求抱抱
    ],
    actionNames: ["委屈抱膝", "闭眼抹泪", "仰头求抱", "抿嘴吸鼻"],
    icons: ["🥺", "💧", "💛", "🫂"],
  },
  custom: {
    frames: ["/desk-pet/puppy.png"],
    actionNames: ["常态待机"],
    icons: ["🎨"],
  },
};

export const PRESET_ASSETS: Record<PetPreset, { name: string; img: string; quote: string; icon: string; desc: string }> = {
  puppy: {
    name: "线条小狗",
    img: "/desk-pet/frames/puppy_0.png",
    quote: "汪汪！大耳朵甩甩，今天也要开开心心交付任务~ 🦴",
    icon: "🐶",
    desc: "纯白治愈萌犬 · 欢快活泼",
  },
  pacman: {
    name: "吃豆人",
    img: "/desk-pet/frames/pacman_0.png",
    quote: "Waka-Waka！消灭 Bug 就像吃豆子一样爽快！🍒👻",
    icon: "🟡",
    desc: "经典 8-bit · 活力吞豆",
  },
  nailong: {
    name: "敏捷奶龙",
    img: "/desk-pet/frames/nailong_0.png",
    quote: "呜呜~ 任务有点难嘛…抱抱我，一起冲刺交付好不好？💛🥺",
    icon: "🐉",
    desc: "呆萌委屈 · 暖心陪伴",
  },
  custom: {
    name: "自定义伙伴",
    img: "/desk-pet/puppy.png",
    quote: "你好呀！我是你的专属敏捷工作助手~ ✨",
    icon: "🎨",
    desc: "自定义立绘 · 独一无二",
  },
};

export function resolveAvatarUrl(url?: string): string {
  if (!url || typeof url !== "string") return "/desk-pet/frames/puppy_0.png";
  const trimmed = url.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return "/desk-pet/frames/puppy_0.png";

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
  const [config, setConfig] = useState<DeskPetConfig>(() => {
    const fallback: DeskPetConfig = {
      preset: "puppy",
      name: "线条小狗",
      customImageUrl: "",
      webPetVisible: true,
    };
    if (typeof window === "undefined") return fallback;
    try {
      const savedConfig = localStorage.getItem("agilecampus.deskpet.config");
      if (savedConfig) {
        return { ...fallback, ...JSON.parse(savedConfig) };
      }
    } catch {}
    return fallback;
  });

  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const savedConfig = localStorage.getItem("agilecampus.deskpet.config");
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        if (parsed.webPetVisible !== undefined) return Boolean(parsed.webPetVisible);
      }
    } catch {}
    return true;
  });

  const [settingsOpen, setSettingsOpen] = useState(false);

  // 设置面板内的表单状态
  const [nameInput, setNameInput] = useState<string>(() => config.name || "线条小狗");
  const [imageUrlInput, setImageUrlInput] = useState<string>(() => config.customImageUrl || "");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  }, []);

  // 坐标位置 (相对于浏览器视口)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const savedPos = localStorage.getItem("agilecampus.webpet.pos");
      if (savedPos) {
        const parsedPos = JSON.parse(savedPos);
        if (typeof parsedPos.x === "number" && typeof parsedPos.y === "number") {
          return parsedPos;
        }
      }
      const defaultX = Math.max(20, window.innerWidth - 250);
      const defaultY = Math.max(40, window.innerHeight - 280);
      return { x: defaultX, y: defaultY };
    } catch {
      return { x: 300, y: 300 };
    }
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({
    mouseX: 0,
    mouseY: 0,
    startX: 0,
    startY: 0,
  });
  const hasMovedRef = useRef(false);

  // 真实逐帧动作状态：通过精细绘制的不同姿态图片来回播放
  const [frameIndex, setFrameIndex] = useState(0);
  const [autoPlayFrames, setAutoPlayFrames] = useState(true);

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
    text: "汪！点击我可以打开装扮与动作设置，按住可随意拖拽位置~",
    allowReply: false,
  });
  const [replyInput, setReplyInput] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bubbleTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 特殊瞬时动作 (完成庆祝起跳 / 报警震颤)
  const [hasAlert, setHasAlert] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  // 已提醒的通知 ID 集合（避免重复弹出同一条通知）
  const handledNotifIdsRef = useRef<Set<string>>(new Set());

  // 客户端挂载安全居中
  useEffect(() => {
    if (position === null) {
      const timer = setTimeout(() => {
        const defaultX = Math.max(20, window.innerWidth - 250);
        const defaultY = Math.max(40, window.innerHeight - 280);
        setPosition({ x: defaultX, y: defaultY });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [position]);

  // 动作帧自动来回播放：每隔 1.8 秒自然平滑切换一个姿态帧 (眨眼 ➔ 摇尾 ➔ 吐舌 ➔ 挥爪)
  useEffect(() => {
    if (!autoPlayFrames || config.preset === "custom" || isDragging) return;
    const currentPack = PRESET_FRAMES[config.preset];
    if (!currentPack || currentPack.frames.length <= 1) return;

    const timer = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % currentPack.frames.length);
    }, 1800);
    return () => clearInterval(timer);
  }, [autoPlayFrames, config.preset, isDragging]);

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

  // 外部自定义事件监听
  useEffect(() => {
    const handlePetEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      if (detail.type === "celebrate") {
        setShowConfetti(true);
        setFrameIndex(2); // 切换到萌笑开怀帧
        triggerBubble("🎉 任务完成庆祝！", detail.title ? `太棒啦！「${detail.title}」已顺利交付验收！` : "团队里程碑+1，向交付胜利冲刺！", false, undefined, 6000);
        setTimeout(() => setShowConfetti(false), 2500);
      } else if (detail.type === "overdue") {
        setHasAlert(true);
        triggerBubble("⚠️ 任务即将逾期预警", detail.text || `任务「${detail.title || "敏捷任务"}」截止时间临近，请加紧推进或呼叫搭手！`, true, undefined, 8000);
      } else if (detail.type === "open-settings") {
        setSettingsOpen(true);
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
          setNameInput(detail.name);
          triggerBubble("✨ 桌宠新名字", `你好呀！以后我就是你的专属「${detail.name}」啦~`, false, undefined, 5000);
        }
      }
    };

    window.addEventListener("agilecampus:deskpet-event", handlePetEvent);
    return () => window.removeEventListener("agilecampus:deskpet-event", handlePetEvent);
  }, [triggerBubble]);

  // 定时轮询网站新通知与互动事件
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
            if (data.config.name && !nameInput) {
              setNameInput(data.config.name);
            }
          }
        }

        // 消费事件队列
        if (data.events && data.events.length > 0) {
          for (const ev of data.events) {
            if (ev.type === "celebrate") {
              setShowConfetti(true);
              setFrameIndex(2);
              triggerBubble("🎉 任务完成庆祝！", `太棒啦！「${ev.title || "任务"}」已顺利交付验收！`, false, undefined, 6000);
              setTimeout(() => setShowConfetti(false), 2500);
            } else if (ev.type === "overdue") {
              setHasAlert(true);
              triggerBubble("⚠️ 即将逾期警报", `紧急：${ev.title || "关键任务"} 截止时间已临近，请尽快推进！`, true, undefined, 8000);
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
  }, [config.customImageUrl, config.name, config.preset, nameInput, triggerBubble]);

  // 鼠标拖拽与点击交互
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

    // 点击桌宠本体（未发生拖拽）：立刻呼出桌宠设置界面！
    if (!hasMovedRef.current) {
      const pack = PRESET_FRAMES[config.preset];
      if (pack && pack.frames.length > 2) {
        setFrameIndex(2); // 萌态动作帧
      }
      setSettingsOpen(true);
      showToast("⚙️ 已打开桌宠设置面板");
    } else if (position) {
      try {
        localStorage.setItem("agilecampus.webpet.pos", JSON.stringify(position));
      } catch {}
    }
  };

  // 提交回复并消去通知
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

  // 设置操作：保存桌宠名字
  const handleRename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed) {
      showToast("桌宠名字不能为空哦~");
      return;
    }
    const newConfig: DeskPetConfig = {
      ...config,
      name: trimmed,
    };
    setConfig(newConfig);

    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, name: trimmed }));
    } catch {}

    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-config", config: newConfig }),
      });
    } catch {}

    showToast(`✨ 桌宠已成功命名为【${trimmed}】！`);
  };

  // 设置操作：切换预设形象
  const switchPreset = async (preset: PetPreset) => {
    const names: Record<PetPreset, string> = {
      puppy: "线条小狗",
      pacman: "吃豆人",
      nailong: "敏捷奶龙",
      custom: "自定义伙伴",
    };
    const targetName = config.name && config.name !== names[config.preset] ? config.name : names[preset];
    const newConfig: DeskPetConfig = {
      ...config,
      preset,
      name: targetName,
    };
    setConfig(newConfig);
    setNameInput(targetName);
    setFrameIndex(0);

    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, ...newConfig }));
    } catch {}

    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-config", config: newConfig }),
      });
    } catch {}

    showToast(`已切换为【${names[preset]}】形象！`);
  };

  // 设置操作：应用自定义立绘
  const applyCustomImage = async (urlToApply?: string) => {
    const rawUrl = (urlToApply !== undefined ? urlToApply : imageUrlInput).trim().replace(/^["']|["']$/g, "");
    if (!rawUrl) {
      showToast("请输入或选择有效的图片文件地址~");
      return;
    }

    const newConfig: DeskPetConfig = {
      ...config,
      preset: "custom",
      customImageUrl: rawUrl,
    };
    setConfig(newConfig);
    setFrameIndex(0);

    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, ...newConfig }));
    } catch {}

    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-config", config: newConfig }),
      });
    } catch {}

    showToast("🎨 自定义立绘已成功应用！");
  };

  // 本地文件挑选
  const handleLocalFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result as string;
      setImageUrlInput(base64Data);
      void applyCustomImage(base64Data);
    };
    reader.readAsDataURL(file);
  };

  // 呼叫居中
  const recallPetToCenter = async () => {
    const defaultX = Math.max(20, Math.round((window.innerWidth - 220) / 2));
    const defaultY = Math.max(40, Math.round((window.innerHeight - 250) / 2));
    setPosition({ x: defaultX, y: defaultY });
    setVisible(true);

    try {
      localStorage.setItem("agilecampus.webpet.pos", JSON.stringify({ x: defaultX, y: defaultY }));
    } catch {}

    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-pos" }),
      });
    } catch {}

    showToast("📍 已将桌宠呼回屏幕正中！");
  };

  // 切换显隐
  const toggleVisibility = (nextVisible: boolean) => {
    setVisible(nextVisible);
    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, webPetVisible: nextVisible }));
    } catch {}

    showToast(nextVisible ? "👾 网页桌宠已唤出！" : "🙈 网页桌宠已收起，可随时在右下角唤出");
  };

  const currentAsset = PRESET_ASSETS[config.preset] || PRESET_ASSETS.puppy;
  const pack = PRESET_FRAMES[config.preset];

  // 计算当前要显示的图片真实地址 (多动作帧)
  let avatarRaw = currentAsset.img;
  if (config.preset === "custom" && config.customImageUrl) {
    avatarRaw = config.customImageUrl;
  } else if (pack && pack.frames.length > 0) {
    avatarRaw = pack.frames[frameIndex % pack.frames.length];
  }
  const avatarSrc = resolveAvatarUrl(avatarRaw);

  return (
    <>
      {/* 极简且高级的悬浮微呼吸动效 (完全不改变图片原本比例，绝不拉伸变形) */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes pet-gentle-float {
              0%, 100% { transform: translateY(0px); }
              50% { transform: translateY(-3px); }
            }
            @keyframes pet-gentle-shadow {
              0%, 100% { transform: scale(1); opacity: 0.22; }
              50% { transform: scale(0.92); opacity: 0.16; }
            }
            .ac-pet-avatar {
              animation: pet-gentle-float 3.2s ease-in-out infinite;
            }
            .ac-pet-shadow {
              animation: pet-gentle-shadow 3.2s ease-in-out infinite;
            }
          `,
        }}
      />

      {/* 当桌宠被收起隐藏时，在右下角提供轻量小挂件，点击即可重新唤醒并进入设置 */}
      {!visible && (
        <div
          onClick={() => {
            toggleVisibility(true);
            setSettingsOpen(true);
          }}
          className="fixed bottom-5 right-5 z-[65] flex items-center gap-2 px-3.5 py-2 rounded-full bg-panel/95 hover:bg-panel border border-stroke-strong shadow-pop text-xs text-ink cursor-pointer transition-all hover:scale-105 active:scale-95 select-none backdrop-blur-xs"
          title="桌宠已收起，点击重新唤醒并打开设置"
        >
          <span className="text-base animate-bounce">👾</span>
          <span className="font-semibold text-xs text-ink">{config.name || "网页桌宠"}</span>
          <span className="text-[10px] text-emerald-700 font-bold bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
            点击唤醒与设置
          </span>
        </div>
      )}

      {/* 浮动桌宠本体 */}
      {visible && position && (
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

          {/* 2. 角色立绘主体 (支持点击直达设置，按住可拖拽) */}
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative cursor-pointer active:cursor-grabbing p-1 group transition-transform hover:scale-105"
            title="点击打开桌宠设置 · 按住可拖拽位置"
          >
            {/* 悬停时的提示徽章 */}
            <div className="absolute -top-2 left-1/2 -translate-x-1/2 bg-slate-900/90 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap flex items-center gap-1 z-10">
              <span>⚙️</span>
              <span>点击设置</span>
            </div>

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
                className="absolute top-1 right-2 w-5 h-5 bg-rose-500 text-white rounded-full flex items-center justify-center font-bold text-xs shadow-md border-2 border-white animate-pulse cursor-pointer z-10"
                title="点击消除提醒"
              >
                !
              </div>
            )}

            {/* 角色本体 (真实逐帧姿态图像，配合高雅微浮，绝无生硬拉扯变形) */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarSrc}
              alt={config.name || currentAsset.name}
              draggable={false}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).src = "/desk-pet/frames/puppy_0.png";
              }}
              className={`w-28 h-28 object-contain [image-rendering:pixelated] drop-shadow-[0_8px_12px_rgba(0,0,0,0.35)] transition-all select-none ${
                isDragging ? "opacity-90 scale-95" : "ac-pet-avatar"
              }`}
            />

            {/* 地面软阴影 */}
            <div
              className={`w-16 h-3 bg-black/20 rounded-full mx-auto blur-[1.5px] mt-0.5 transition-all ${
                isDragging ? "scale-75 opacity-10" : "ac-pet-shadow"
              }`}
            />
          </div>
        </div>
      )}

      {/* 3. 桌宠设置与装扮弹窗 (点击桌宠直接唤起) */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-ink/35 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-panel border border-stroke-strong rounded-2xl shadow-pop overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-150"
          >
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-stroke bg-sunken/40">
              <div className="flex items-center gap-2.5">
                <span className="text-2xl animate-bounce">👾</span>
                <div>
                  <h3 className="text-sm font-bold text-ink flex items-center gap-2">
                    <span>网页桌宠设置中心</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold">
                      {config.name || "线条小狗"}
                    </span>
                  </h3>
                  <p className="text-[11px] text-ink-3">点击桌宠快速配置 · 个性命名 · 动作轮换 · 像素立绘</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-ink-3 hover:text-ink text-sm p-1.5 rounded-md hover:bg-neutral-200/60 transition-colors cursor-pointer"
                title="关闭设置"
              >
                ✕
              </button>
            </div>

            {/* 主体设置区 */}
            <div className="p-5 space-y-4 overflow-y-auto">
              {/* 1. 桌宠专属命名 */}
              <div className="rounded-xl border border-stroke p-3.5 bg-sunken/30 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
                    <span>🏷️ 桌宠专属昵称</span>
                  </label>
                  <span className="text-[11px] text-ink-3">对话气泡将显示此称呼</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleRename()}
                    placeholder="输入名字，如：呆呆龙、小黄鸭、旺财..."
                    maxLength={16}
                    className="flex-1 bg-panel border border-stroke rounded-lg px-3 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-signal"
                  />
                  <button
                    type="button"
                    onClick={handleRename}
                    className="text-xs px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
                  >
                    保存命名
                  </button>
                </div>
              </div>

              {/* 2. 真实动作帧与轮换秀场 */}
              <div className="rounded-xl border border-stroke p-3.5 bg-sunken/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                    <span>🎭 姿态帧与动作秀场</span>
                    <span className="text-[10px] text-emerald-700 bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 rounded-full font-bold">
                      {autoPlayFrames ? "● 姿态自动循环中" : "○ 已暂停循环"}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !autoPlayFrames;
                      setAutoPlayFrames(next);
                      showToast(next ? "🔄 已开启姿态帧自动轮播！" : "⏸️ 已暂停轮换，锁定当前姿态");
                    }}
                    className="text-[11px] font-semibold text-signal hover:underline cursor-pointer"
                  >
                    {autoPlayFrames ? "暂停轮换" : "开启循环"}
                  </button>
                </div>

                {pack && pack.frames.length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {pack.frames.map((f, idx) => {
                      const isCurrent = frameIndex % pack.frames.length === idx;
                      const actionName = pack.actionNames[idx] || `动作 ${idx + 1}`;
                      const actionIcon = pack.icons[idx] || "✨";
                      return (
                        <button
                          key={f}
                          type="button"
                          onClick={() => {
                            setFrameIndex(idx);
                            showToast(`🎭 已切换到姿态帧「${actionName}」`);
                          }}
                          className={`flex items-center gap-2 p-2 rounded-lg border text-left transition-all cursor-pointer ${
                            isCurrent
                              ? "bg-signal-soft/50 border-signal ring-1 ring-signal text-ink font-semibold shadow-xs"
                              : "bg-panel border-stroke hover:border-stroke-strong text-ink-2"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={f}
                            alt={actionName}
                            className="w-8 h-8 object-contain [image-rendering:pixelated]"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-bold truncate flex items-center gap-1">
                              <span>{actionIcon}</span>
                              <span>{actionName}</span>
                            </div>
                            <div className="text-[9px] text-ink-3">
                              {isCurrent ? "当前播放" : "点击展示"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-[10px] text-ink-3">
                  提示：桌宠在平时会在这几幅姿态间自然轮播；拖拽时悬空晃动，松开时弹性就位！
                </p>
              </div>

              {/* 3. 像素画风预设形象切换 */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-ink block">
                  选择预设像素形象
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {(["puppy", "pacman", "nailong"] as PetPreset[]).map((presetKey) => {
                    const item = PRESET_ASSETS[presetKey];
                    const isSelected = config.preset === presetKey;
                    return (
                      <button
                        key={presetKey}
                        type="button"
                        onClick={() => switchPreset(presetKey)}
                        className={`flex flex-col items-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                          isSelected
                            ? "border-signal bg-signal-soft/40 ring-2 ring-signal/30 font-semibold text-ink shadow-xs"
                            : "border-stroke hover:border-stroke-strong bg-panel text-ink-2"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.img}
                          alt={item.name}
                          className="w-14 h-14 object-contain mb-1.5 [image-rendering:pixelated]"
                        />
                        <span className="text-xs font-bold text-ink">{item.name}</span>
                        <span className="text-[10px] text-ink-3">{item.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 4. 自定义立绘形象 */}
              <div className="rounded-xl border border-stroke p-3 bg-sunken/30 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-ink flex items-center gap-1.5">
                    <span>🎨 自定义立绘（支持本地选择或图片链接）</span>
                  </span>
                  {config.preset === "custom" && (
                    <span className="text-[10px] text-signal font-bold">● 当前已生效自定义</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={imageUrlInput}
                    onChange={(e) => setImageUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void applyCustomImage()}
                    placeholder="输入图片URL或本地文件路径..."
                    className="flex-1 bg-panel border border-stroke rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-signal"
                  />

                  {/* 本地文件挑选器 */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLocalFileSelect}
                    className="hidden"
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title="从本地电脑挑选图片"
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-stroke bg-panel hover:bg-neutral-100 text-ink font-semibold active:scale-95 cursor-pointer whitespace-nowrap"
                  >
                    📁 本地选择
                  </button>

                  <button
                    type="button"
                    onClick={() => applyCustomImage()}
                    className="text-xs px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all shadow-xs active:scale-95 cursor-pointer whitespace-nowrap"
                  >
                    应用立绘
                  </button>
                </div>

                {/* 缩略图预览 */}
                {imageUrlInput && (
                  <div className="flex items-center gap-3 p-2 bg-panel rounded-lg border border-stroke/70">
                    <div className="w-12 h-12 bg-neutral-100 rounded-md flex items-center justify-center overflow-hidden border border-stroke/50">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={resolveAvatarUrl(imageUrlInput)}
                        alt="自定义预览"
                        className="w-full h-full object-contain [image-rendering:pixelated]"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                    </div>
                    <div className="text-[11px] text-ink-3 flex-1 min-w-0">
                      <div className="text-ink font-medium truncate">
                        {imageUrlInput.startsWith("data:") ? "本地选取的图片（已就绪）" : imageUrlInput}
                      </div>
                      <div className="text-[10px] text-emerald-600">
                        {config.preset === "custom" && config.customImageUrl === imageUrlInput.trim().replace(/^["']|["']$/g, "")
                          ? "✓ 正在使用此立绘"
                          : "点击「应用立绘」即可立即切换为此形象"}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 5. 位置与状态快捷管理 */}
              <div className="flex items-center justify-between rounded-xl border border-stroke p-3 bg-sunken/20">
                <div className="text-[11px] text-ink-3">
                  若桌宠移至屏外，可一键将其召回正中央
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={recallPetToCenter}
                    className="text-xs px-3 py-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 font-bold active:scale-95 cursor-pointer"
                  >
                    📍 居中召回
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      toggleVisibility(false);
                      setSettingsOpen(false);
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border border-stroke bg-panel hover:bg-neutral-100 text-ink-2 font-medium active:scale-95 cursor-pointer"
                  >
                    🙈 收起桌宠
                  </button>
                </div>
              </div>
            </div>

            {/* 底部按钮栏 */}
            <div className="px-5 py-3 border-t border-stroke bg-sunken/40 flex items-center justify-between">
              <span className="text-[11px] text-ink-3">
                提示：轻点桌宠本体可随时再次唤出此面板。
              </span>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="text-xs px-5 py-1.5 rounded-lg bg-ink text-white font-medium hover:bg-ink-2 cursor-pointer shadow-xs"
              >
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 底部全局 Toast 提示 */}
      {toastMessage && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] bg-ink text-white text-xs px-4 py-2 rounded-full shadow-pop flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150">
          <span>👾</span>
          <span>{toastMessage}</span>
        </div>
      )}
    </>
  );
}
