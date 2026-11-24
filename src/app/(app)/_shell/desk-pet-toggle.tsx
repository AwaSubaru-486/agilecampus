"use client";

export type { PetPreset, DeskPetConfig } from "./web-desk-pet";
export { resolveAvatarUrl } from "./web-desk-pet";

/**
 * 桌宠设置已全部切换为直接点击网页桌宠本体呼出设置界面。
 * 本组件保留为兼容入口，若需要触发可派发 open-settings 事件。
 */
export function DeskPetToggle() {
  return null;
}
