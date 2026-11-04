/** Must run from a user's click. Never accepts arbitrary web/script/file URLs. */
export function launchDesktopClient(value: string, documentTarget: Document = document) {
  const url = new URL(value);
  if (url.protocol !== "agilecampus-pet:" || url.hostname !== "connect" || url.pathname || url.username || url.password || url.hash)
    throw new Error("桌宠唤起地址无效，请重新生成连接");
  const link = documentTarget.createElement("a");
  link.href = url.toString();
  link.style.display = "none";
  documentTarget.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
}
