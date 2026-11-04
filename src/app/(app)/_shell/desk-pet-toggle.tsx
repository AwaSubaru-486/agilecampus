"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { resolveAvatarUrl } from "./web-desk-pet";

export type PetPreset = "puppy" | "pacman" | "nailong" | "custom";

interface DeskPetConfig {
  preset: PetPreset;
  name: string;
  customImageUrl?: string;
  webPetVisible?: boolean;
}

interface DeskPetStatus {
  config: DeskPetConfig;
}

export function DeskPetToggle() {
  const [panelOpen, setPanelOpen] = useState(false);
  const [webPetVisible, setWebPetVisible] = useState(true);
  const [config, setConfig] = useState<DeskPetConfig>({
    preset: "puppy",
    name: "线条小狗",
    customImageUrl: "",
    webPetVisible: true,
  });

  // 自定义名字输入状态
  const [nameInput, setNameInput] = useState("");
  // 自定义图片地址状态
  const [imageUrlInput, setImageUrlInput] = useState("");
  // 文件选择 input ref
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // 1. 初始化持久化设置
  useEffect(() => {
    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      if (saved) {
        const parsed = JSON.parse(saved);
        setConfig((prev) => ({ ...prev, ...parsed }));
        if (parsed.name) setNameInput(parsed.name);
        if (parsed.customImageUrl) setImageUrlInput(parsed.customImageUrl);
        if (parsed.webPetVisible !== undefined) {
          setWebPetVisible(parsed.webPetVisible);
        }
      }
    } catch {}
  }, []);

  // 2. 定时轮询桌宠配置 (每 4 秒)
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/desktop-pet/status", { cache: "no-store" });
      if (res.ok) {
        const data: DeskPetStatus = await res.json();
        if (data.config) {
          setConfig((prev) => ({ ...prev, ...data.config }));
          if (!nameInput && data.config.name) {
            setNameInput(data.config.name);
          }
          if (!imageUrlInput && data.config.customImageUrl) {
            setImageUrlInput(data.config.customImageUrl);
          }
        }
      }
    } catch {}
  }, [imageUrlInput, nameInput]);

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(refreshStatus, 4000);
    return () => clearInterval(interval);
  }, [refreshStatus]);

  // 切换网页内浮动桌宠显隐
  const toggleWebPet = (nextVisible: boolean) => {
    setWebPetVisible(nextVisible);
    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, webPetVisible: nextVisible }));
    } catch {}
    window.dispatchEvent(new CustomEvent("agilecampus:deskpet-event", {
      detail: { type: "toggle-visibility", visible: nextVisible }
    }));
    showToast(nextVisible ? "👾 网页桌宠已显示" : "🙈 网页桌宠已隐藏");
  };

  // 呼叫居中（防拖拽越界走失，一键召回视口中央）
  const recallPetToCenter = async () => {
    window.dispatchEvent(new CustomEvent("agilecampus:deskpet-event", {
      detail: { type: "reset-pos" }
    }));
    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset-pos" }),
      });
    } catch {}
    showToast("📍 已将桌宠呼回屏幕正中！");
  };

  // 保存桌宠名字 (【命名】按钮响应)
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

    // 1. 通知网页桌宠
    window.dispatchEvent(new CustomEvent("agilecampus:deskpet-event", {
      detail: { type: "rename", name: trimmed }
    }));

    // 2. 本地持久化
    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, name: trimmed }));
    } catch {}

    // 3. 同步后端
    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-config", config: newConfig }),
      });
    } catch {}

    showToast(`✨ 桌宠已成功命名为【${trimmed}】！`);
  };

  // 切换预设形象
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

    // 1. 即时通知当前页面中的网页桌宠
    window.dispatchEvent(new CustomEvent("agilecampus:deskpet-event", {
      detail: { type: "switch-preset", preset, name: targetName, customUrl: newConfig.customImageUrl }
    }));

    // 2. 本地持久化
    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, ...newConfig }));
    } catch {}

    // 3. 同步后端
    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-config", config: newConfig }),
      });
      showToast(`已切换为【${names[preset]}】形象！`);
    } catch {}
  };

  // 应用自定义立绘 (支持文件路径、URL、本地选择)
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

    // 1. 即时通知当前页面中的网页桌宠
    window.dispatchEvent(new CustomEvent("agilecampus:deskpet-event", {
      detail: { type: "switch-preset", preset: "custom", customUrl: rawUrl, name: config.name }
    }));

    // 2. 本地持久化
    try {
      const saved = localStorage.getItem("agilecampus.deskpet.config");
      const current = saved ? JSON.parse(saved) : {};
      localStorage.setItem("agilecampus.deskpet.config", JSON.stringify({ ...current, ...newConfig }));
    } catch {}

    // 3. 同步后端
    try {
      await fetch("/api/desktop-pet/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-config", config: newConfig }),
      });
    } catch {}

    showToast("🎨 自定义立绘已应用成功并在网页中生效！");
  };

  // 本地文件选择回调
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

  return (
    <>
      {/* 顶部/导航栏内的快捷桌宠按钮 */}
      <div
        onClick={() => setPanelOpen(true)}
        title="打开网页桌宠装扮中心"
        className="ac-nav-item relative flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg border border-stroke bg-panel/70 hover:bg-neutral-100 transition-all text-ink cursor-pointer"
      >
        <span className="flex items-center gap-1.5 font-medium">
          <span className="text-sm">👾</span>
          <span>{config.name || "网页桌宠"}</span>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleWebPet(!webPetVisible);
          }}
          title={webPetVisible ? "点击隐藏网页桌宠" : "点击显示网页桌宠"}
          className={`ml-2 text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 transition-all hover:scale-105 active:scale-95 ${
            webPetVisible
              ? "bg-emerald-500/15 text-emerald-700 border border-emerald-500/40"
              : "bg-neutral-200/80 text-neutral-600 border border-neutral-300"
          }`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${webPetVisible ? "bg-emerald-500 animate-pulse" : "bg-neutral-400"}`} />
          <span>{webPetVisible ? "已开启" : "点击显示"}</span>
        </button>
      </div>

      {/* 控制与装扮弹窗 */}
      {panelOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-ink/30 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-panel border border-stroke-strong rounded-2xl shadow-pop overflow-hidden flex flex-col max-h-[90vh]">
            {/* 标题栏 */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-stroke bg-sunken/40">
              <div className="flex items-center gap-2">
                <span className="text-xl">👾</span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">网页桌宠装扮与自定义中心</h3>
                  <p className="text-[11px] text-ink-3">自定义桌宠名字 · 本地图片与链接立绘 · 像素无边框互动</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="text-ink-3 hover:text-ink text-sm p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            {/* 主体区 */}
            <div className="p-5 space-y-5 overflow-y-auto">
              {/* 1. 网页浮动桌宠开关与居中召回 */}
              <div className="rounded-xl border border-emerald-500/30 p-4 bg-emerald-500/5 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-ink flex items-center gap-2">
                    <span>🌟 网页常驻桌宠</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                        webPetVisible
                          ? "bg-emerald-500 text-white"
                          : "bg-neutral-300 text-neutral-700"
                      }`}
                    >
                      {webPetVisible ? "● 正在网页中显示" : "○ 已隐藏"}
                    </span>
                  </div>
                  <p className="text-[11px] text-ink-3 mt-1">
                    当前名称：<b className="text-ink font-semibold">{config.name || "线条小狗"}</b>，按住鼠标左键可任意拖拽！
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={recallPetToCenter}
                    title="防拖拽越界，一键将桌宠呼回屏幕正中"
                    className="text-xs px-2.5 py-1.5 rounded-xl font-bold border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 transition-all active:scale-95 cursor-pointer"
                  >
                    📍 居中
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleWebPet(!webPetVisible)}
                    className={`text-xs px-3.5 py-1.5 rounded-xl font-bold transition-all shadow-xs flex items-center gap-1.5 active:scale-95 cursor-pointer ${
                      webPetVisible
                        ? "bg-neutral-200 hover:bg-neutral-300 text-neutral-800"
                        : "bg-emerald-600 hover:bg-emerald-700 text-white"
                    }`}
                  >
                    {webPetVisible ? "隐藏桌宠" : "立即显示"}
                  </button>
                </div>
              </div>

              {/* 2. 桌宠专属命名区域（新增命名输入与【命名】按钮） */}
              <div className="rounded-xl border border-stroke p-4 bg-sunken/40 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
                    <span>🏷️ 给你的桌宠起个名字</span>
                  </label>
                  <span className="text-[11px] text-ink-3">气泡与互动将使用此称呼</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void handleRename()}
                    placeholder="例如：呆呆龙、小黄鸭、旺财..."
                    maxLength={16}
                    className="flex-1 bg-panel border border-stroke rounded-lg px-3 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-signal"
                  />
                  <button
                    type="button"
                    onClick={handleRename}
                    className="text-xs px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-all shadow-xs active:scale-95 cursor-pointer"
                  >
                    命名
                  </button>
                </div>
              </div>

              {/* 3. 像素画风形象切换 */}
              <div className="space-y-2.5">
                <label className="text-xs font-semibold text-ink block">
                  选择预设像素画风形象
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  {[
                    { id: "puppy", name: "线条小狗", sub: "纯白治愈萌犬", icon: "🐶", img: "/desk-pet/puppy.png" },
                    { id: "pacman", name: "吃豆人", sub: "复古 8-bit 经典", icon: "🟡", img: "/desk-pet/pacman.png" },
                    { id: "nailong", name: "敏捷奶龙", sub: "委屈呆萌求带飞", icon: "🐉", img: "/desk-pet/nailong.png" },
                  ].map((p) => {
                    const isSelected = config.preset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => switchPreset(p.id as PetPreset)}
                        className={`flex flex-col items-center p-3 rounded-xl border text-center transition-all cursor-pointer ${
                          isSelected
                            ? "border-signal bg-signal-soft/40 ring-2 ring-signal/30 font-semibold text-ink shadow-xs"
                            : "border-stroke hover:border-stroke-strong bg-panel text-ink-2"
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.img}
                          alt={p.name}
                          className="w-14 h-14 object-contain mb-1.5 [image-rendering:pixelated]"
                        />
                        <span className="text-xs font-bold text-ink">{p.name}</span>
                        <span className="text-[10px] text-ink-3">{p.sub}</span>
                      </button>
                    );
                  })}
                </div>

                {/* 4. 自定义形象立绘（支持输入本地文件路径、网络URL、本地文件选择） */}
                <div className="rounded-xl border border-stroke p-3 bg-sunken/40 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-ink flex items-center gap-1.5">
                      <span>🎨 自定义立绘形象（支持本地文件路径与选择）</span>
                    </span>
                    {config.preset === "custom" && (
                      <span className="text-[10px] text-signal font-bold">● 当前已生效自定义</span>
                    )}
                  </div>

                  {/* 输入行与选择本地文件 */}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={imageUrlInput}
                      onChange={(e) => setImageUrlInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void applyCustomImage()}
                      placeholder="输入本地图片路径（如 C:\Pictures\my.png）或网络图片URL..."
                      className="flex-1 bg-panel border border-stroke rounded-lg px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-4 focus:outline-none focus:border-signal"
                    />

                    {/* 隐藏的本地文件选择器 */}
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
                      title="直接从本地电脑挑选图片"
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

                  {/* 实时立绘缩略图预览 */}
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
                            : "点击「应用立绘」即可立即切换为该形象"}
                        </div>
                      </div>
                    </div>
                  )}

                  <p className="text-[10px] text-ink-3 leading-relaxed">
                    💡 贴心提示：无论您是直接粘贴 Windows 本地路径（如 <code>C:\xxx\pet.png</code>），还是点击<b>「📁 本地选择」</b>挑选本地文件，系统均会自动安全桥接，支持 PNG、WebP、JPG 或 GIF！
                  </p>
                </div>
              </div>
            </div>

            {/* 底部操作区 */}
            <div className="px-5 py-3 border-t border-stroke bg-sunken/40 flex items-center justify-between">
              <span className="text-[11px] text-ink-3">
                提示：鼠标左键按住桌宠可拖放到页面任意角落。
              </span>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="text-xs px-4 py-1.5 rounded-lg bg-ink text-white font-medium hover:bg-ink-2 cursor-pointer"
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
