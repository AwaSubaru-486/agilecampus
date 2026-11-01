import { auth } from "@/lib/auth";
import { getHomeView } from "@/lib/home";
import { AppError } from "@/lib/errors";
import { redirect } from "next/navigation";
import Link from "next/link";
import { HomeSpace } from "./home-space";
import styles from "./home.module.css";

export const metadata = { title: "家园 · AgileCampus" };

export default async function HomePage({ searchParams }: { searchParams: Promise<{ view?: string; owner?: string; team?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  let data;
  try { data = await getHomeView(session.user.id, await searchParams); }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    return <div className={styles.unavailable}><span>⌂</span><h1>这次还不能进门</h1><p>{error.message}</p><Link className="ac-btn" href="/home">回到我的家园</Link></div>;
  }
  return <HomeSpace key={`${data.view}:${data.home.ownerId}:${data.teamId}`} data={data} />;
}
