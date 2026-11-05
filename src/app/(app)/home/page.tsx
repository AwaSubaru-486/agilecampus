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
  try {
    const { team } = await searchParams;
    data = await getHomeView(session.user.id, { view: "courtyard", team });
  }
  catch (error) {
    if (!(error instanceof AppError)) throw error;
    return <div className={styles.unavailable}><span>⌂</span><h1>暂时无法进入庭院</h1><p>{error.message}</p><Link className="ac-btn" href="/home">返回团队庭院</Link></div>;
  }
  return <HomeSpace key={`${data.view}:${data.home.ownerId}:${data.teamId}`} data={data} />;
}
