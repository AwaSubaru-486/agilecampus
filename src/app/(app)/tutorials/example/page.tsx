import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTutorialProgress } from "@/lib/tutorials/progress";
import { EMPTY_EXAMPLE } from "@/lib/tutorials/example-flow";
import { ExampleWorkspace } from "./workspace";

export default async function ExamplePage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const progress = await getTutorialProgress(session.user.id);
  const query = await searchParams;
  return (
    <ExampleWorkspace
      initial={progress.example ?? EMPTY_EXAMPLE}
      requestedPhase={Number(query.phase ?? progress.example?.phase ?? 0)}
    />
  );
}
