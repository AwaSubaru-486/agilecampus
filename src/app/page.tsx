import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

// 登录后的落点。
//
// 从前是 /teams——用户第一次看到的是「我的团队」卡片。
// V2 的第一个问题不是「系统里有什么」，而是「现在该我做什么」，
// 故落到 /today 的行动队列。
export default async function Home() {
  const session = await auth();
  redirect(session?.user ? "/today" : "/login");
}
