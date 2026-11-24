"use client";

import { Suspense, useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { loginAction, type FormState } from "./actions";
import { FeishuLogin } from "./feishu-login";

function LoginForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    loginAction,
    null,
  );
  const registered = useSearchParams().get("registered");

  return (
    <main className="mx-auto w-full max-w-md space-y-6 ac-focus-card p-7 sm:p-9">
      <h1 className="font-display text-2xl font-semibold text-ink">
        登录 AgileCampus
      </h1>
      {registered && <p className="text-sm text-done">注册成功，请登录。</p>}
      <form action={formAction} className="space-y-3">
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
            autoComplete="current-password"
            required
            className="ac-field mt-2"
          />
        </label>
        {state?.error && <p className="text-sm text-high">{state.error}</p>}
        <button disabled={pending} className="ac-btn w-full">
          {pending ? "登录中…" : "登录"}
        </button>
      </form>
      <p className="text-sm text-ink-soft">
        没有账号？
        <Link href="/register" className="text-primary hover:underline">
          去注册
        </Link>
      </p>
      <FeishuLogin />
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
