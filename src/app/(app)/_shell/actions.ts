"use server";

import { signOut } from "@/lib/auth";

// 退出登录。放在 _shell 下，因为它是工作带上账户菜单的动作，
// 不属于任何业务路由。
export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
