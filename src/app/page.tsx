import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// 登录后的首页进入项目列表。
export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/projects" : "/login");
}
