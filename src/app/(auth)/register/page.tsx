"use client";

import { useActionState } from "react";
import Link from "next/link";
import { registerAction, type FormState } from "./actions";

export default function RegisterPage() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    registerAction,
    null,
  );

  return (
    <main className="mx-auto w-full max-w-md space-y-6 ac-focus-card p-7 sm:p-9">
      <h1 className="font-display text-2xl font-semibold text-ink">
        注册 AgileCampus
      </h1>
      <form action={formAction} className="space-y-3">
        <label className="block text-xs text-ink-2">
          姓名
          <input
            name="name"
            autoComplete="name"
            required
            placeholder="团队中显示的名字"
            className="ac-field mt-2"
          />
        </label>
        <label className="block text-xs text-ink-2">
          邮箱
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="name@campus.edu"
            className="ac-field mt-2"
          />
        </label>
        <label className="block text-xs text-ink-2">
          密码
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            placeholder="至少 8 位"
            className="ac-field mt-2"
          />
        </label>
        {state?.error && <p className="text-sm text-high">{state.error}</p>}
        <button disabled={pending} className="ac-btn w-full">
          {pending ? "注册中…" : "注册"}
        </button>
      </form>
      <p className="text-sm text-ink-soft">
        已有账号？
        <Link href="/login" className="text-primary hover:underline">
          去登录
        </Link>
      </p>
    </main>
  );
}
