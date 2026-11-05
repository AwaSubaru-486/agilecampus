import { redirect } from "next/navigation";

export const metadata = { title: "家园 · AgileCampus" };

export default function HomePage() {
  redirect("/projects");
}
