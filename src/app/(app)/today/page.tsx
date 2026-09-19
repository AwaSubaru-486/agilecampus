import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listMyActionItems } from "@/lib/shell";

// 今日：跨项目的行动队列。取代旧版登录后落到的「项目卡片网格」。
//
// 旧版问「有哪些项目」，这里问「现在该我做什么」。
// Commit 2 先落一个精简版（待回应 + 待验收），Commit 4 再补全六类行动、
// 排序规则与项目脉搏。
export default async function TodayPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { awaiting, toReview } = await listMyActionItems(session.user.id);
  const total = awaiting.length + toReview.length;

  return (
    <div className="mx-auto max-w-[80rem] space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">
          {session.user.name ? `${session.user.name}，今天` : "今天"}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          {total === 0
            ? "眼下没有需要你回应的事。"
            : `${total} 件事等你动手。`}
        </p>
      </header>

      {total === 0 ? (
        <div className="ac-card p-8 text-center text-sm text-ink-2">
          没有待回应、也没有待验收的活。去
          <Link href="/projects" className="mx-1 text-signal hover:underline">
            项目
          </Link>
          看看团队在做什么。
        </div>
      ) : (
        <div className="space-y-5">
          {awaiting.length > 0 && (
            <ActionGroup
              title="需要你现在回应"
              hint="派给你的活，你还没说接不接得住"
              items={awaiting}
            />
          )}
          {toReview.length > 0 && (
            <ActionGroup
              title="等你验收"
              hint="交付已提交，判断做没做对"
              items={toReview}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ActionGroup({
  title,
  hint,
  items,
}: {
  title: string;
  hint: string;
  items: Awaited<ReturnType<typeof listMyActionItems>>["awaiting"];
}) {
  return (
    <section className="ac-card overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="text-xs text-ink-3">{hint}</p>
      </header>
      <ul className="divide-y divide-stroke">
        {items.map((it) => (
          <li key={it.taskId}>
            <Link
              href={`/projects/${it.projectId}?task=${it.taskId}`}
              className="flex flex-wrap items-baseline gap-2 px-4 py-3 transition-colors hover:bg-sunken"
            >
              <span className="text-sm font-medium text-ink">{it.title}</span>
              <span className="text-xs text-ink-3">{it.projectName}</span>
              {it.assigneeName && (
                <span className="text-xs text-ink-3">· {it.assigneeName}</span>
              )}
              {it.overdue && <span className="text-xs font-medium text-risk">已逾期</span>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
