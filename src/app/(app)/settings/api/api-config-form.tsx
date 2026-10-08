"use client";
import { useActionState, useState } from "react";
import { saveApiConfig } from "./actions";

export function ApiConfigForm({ config }: { config: { baseUrl: string; model: string; personal: boolean; ready: boolean } }) {
  const [key, setKey] = useState("");
  const [state, action, pending] = useActionState(async (previous: { error?: string; success?: string } | null, form: FormData) => {
    const result = await saveApiConfig(previous, form);
    if (result.success) setKey("");
    return result;
  }, null);
  return <form action={action} onReset={event => event.preventDefault()} data-tour="api-config" data-tour-complete={config.ready || state?.success ? "true" : undefined} className="space-y-6">
    <p className="text-sm text-ink-3">{config.personal ? "已保存个人配置。留空 API Key 可保留已有密钥。" : config.ready ? "站点默认模型已配置，可直接继续教程；也可以设置个人 API。" : "填写你的模型服务配置后保存，再继续教程。"}</p>
    <fieldset disabled={pending} className="space-y-5">
      <label className="block text-sm text-ink">API 地址<input name="baseUrl" type="url" required maxLength={500} defaultValue={config.baseUrl} className="ac-field mt-2 w-full" /><span className="mt-1 block text-xs text-ink-3">使用 OpenAI 兼容接口地址，按服务商说明填写，通常以 /v1 结尾。</span></label>
      <label className="block text-sm text-ink">模型名称<input name="model" required maxLength={120} defaultValue={config.model} className="ac-field mt-2 w-full" /></label>
      <label className="block text-sm text-ink">API Key<input name="apiKey" type="password" autoComplete="new-password" required={!config.personal} maxLength={4096} value={key} onChange={event => setKey(event.target.value)} placeholder={config.personal ? "已保存，留空保留" : "输入服务商提供的 API Key"} className="ac-field mt-2 w-full" /></label>
      <button className="ac-btn" disabled={pending}>{pending ? "保存中…" : "保存 API 配置"}</button>
    </fieldset>
    {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
    {state?.success && <p role="status" className="text-sm text-success">{state.success}</p>}
    <p className="text-xs leading-6 text-ink-3">此配置只属于你的账号。密钥在服务器加密保存，页面不回显。模型调用会将当前请求的任务或会话内容发送至所填服务地址。</p>
  </form>;
}
