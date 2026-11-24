import { redirect } from "next/navigation";
// Keep old bookmarks usable; the walkthrough now runs on existing pages.
export default function RetiredExamplePage() { redirect("/tutorials"); }
