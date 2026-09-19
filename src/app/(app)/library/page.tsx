import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { projectEntries, projects, teamMembers, users } from "@/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { ENTRY_LABEL, type EntryType } from "@/lib/entry-labels";

// 资料库：跨项目的成果与文档。
//
// 需求文档的痛点是「成果散落在不同工具中」——散在**不同项目里**
// 也是散。团队做完一个项目，代码仓库和答辩材料就沉在那个项目页底部，
// 下个项目又要从头找。这一页把它们拉到一处。
//
// 只收成果与文档。老师反馈不进这里——那是针对某个项目的意见，
// 脱离了那个项目就没有意义。
export default async function LibraryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, session.user.id));
  const teamIds = memberships.map((m) => m.teamId);

  if (teamIds.length === 0) {
    return (
      <div className="mx-auto max-w-[70rem]">
        <LibraryHeader total={0} deliverableCount={0} docCount={0} />
        <div className="grid border-b border-stroke py-12 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <p className="text-xs text-ink-3">当前范围</p>
          <p className="text-sm text-ink-2">你还没有加入任何团队，暂无可查看的项目资料。</p>
        </div>
      </div>
    );
  }

  const rows = await db
    .select({
      id: projectEntries.id,
      type: projectEntries.type,
      title: projectEntries.title,
      content: projectEntries.content,
      url: projectEntries.url,
      projectId: projects.id,
      projectName: projects.name,
      authorName: users.name,
      createdAt: projectEntries.createdAt,
    })
    .from(projectEntries)
    .innerJoin(projects, eq(projectEntries.projectId, projects.id))
    .leftJoin(users, eq(projectEntries.authorId, users.id))
    .where(and(inArray(projects.teamId, teamIds), ne(projectEntries.type, "feedback")))
    .orderBy(desc(projectEntries.createdAt))
    .limit(200);

  const deliverables = rows.filter((r) => r.type === "deliverable");
  const docs = rows.filter((r) => r.type === "doc");

  return (
    <div className="mx-auto max-w-[74rem]">
      <LibraryHeader
        total={rows.length}
        deliverableCount={deliverables.length}
        docCount={docs.length}
      />

      {rows.length === 0 ? (
        <div className="grid border-b border-stroke py-16 lg:grid-cols-[12rem_minmax(0,1fr)]">
          <p className="text-sm text-ink-3">还没有归档</p>
          <div>
            <p className="max-w-lg font-display text-xl font-semibold leading-8 text-ink">一份完整的项目，不该只剩聊天记录。</p>
            <p className="mt-3 max-w-xl text-sm leading-7 text-ink-2">
              把代码仓库、数据集、答辩材料或关键说明放进项目记录，它们会在这里留下可追溯的出处。
            </p>
          </div>
        </div>
      ) : (
        <ArchiveLedger rows={rows} />
      )}
    </div>
  );
}

function LibraryHeader({
  total,
  deliverableCount,
  docCount,
}: {
  total: number;
  deliverableCount: number;
  docCount: number;
}) {
  return (
    <header className="grid border-b-2 border-ink lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div className="py-8 sm:py-11">
        <p className="text-xs font-medium tracking-[0.08em] text-ink-3">项目索引</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">资料库</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-ink-2">团队成果与项目文档的统一索引，保留每条记录的出处。</p>
      </div>
      <dl className="grid grid-cols-3 border-t border-stroke text-left lg:border-l lg:border-t-0">
        <Metric label="归档" value={total} />
        <Metric label="成果" value={deliverableCount} />
        <Metric label="文档" value={docCount} />
      </dl>
    </header>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-r border-stroke px-3 py-4 last:border-r-0 lg:flex lg:flex-col lg:justify-end lg:px-4 lg:py-8">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">{String(value).padStart(2, "0")}</dd>
    </div>
  );
}

type Row = {
  id: string;
  type: EntryType;
  title: string;
  content: string | null;
  url: string | null;
  projectId: string;
  projectName: string;
  authorName: string | null;
  createdAt: Date;
};

function ArchiveLedger({ rows }: { rows: Row[] }) {
  return (
    <section className="grid lg:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="border-b border-stroke py-7 lg:border-b-0 lg:border-r lg:py-10 lg:pr-7">
        <p className="text-xs font-medium tracking-[0.08em] text-ink-3">索引视图</p>
        <p className="mt-3 max-w-[10rem] text-sm leading-6 text-ink-2">按记录时间倒序排列，项目出处始终可回溯。</p>
        <div className="mt-8 hidden border-l-2 border-human pl-3 text-xs leading-5 text-ink-3 lg:block">
          绿色短线表示可交付成果，灰色短线表示过程文档。
        </div>
      </aside>
      <div className="lg:pl-9">
        <header className="flex items-baseline justify-between border-b border-stroke py-5">
          <h2 className="text-base font-semibold text-ink">归档记录</h2>
          <p className="font-mono text-[11px] text-ink-3">最新在前</p>
        </header>
        <ol>
        {rows.map((r) => (
          <li key={r.id} className="group grid gap-3 border-b border-stroke py-6 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-5">
            <div className="pt-1 text-xs text-ink-3">
              <time dateTime={r.createdAt.toISOString()} className="block tabular-nums">{formatArchiveDate(r.createdAt)}</time>
              <span className={`mt-3 block h-px w-8 ${r.type === "deliverable" ? "bg-human" : "bg-ink-3"}`} aria-hidden />
              <span className="mt-2 block font-medium">{ENTRY_LABEL[r.type]}</span>
            </div>
            <div className="min-w-0 sm:grid sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:gap-6">
              <div>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline text-lg font-semibold leading-7 text-ink underline decoration-stroke-strong underline-offset-4 transition-colors hover:text-human hover:decoration-human"
                >
                  {r.title}
                </a>
              ) : (
                <span className="text-lg font-semibold leading-7 text-ink">{r.title}</span>
              )}
              {r.content && (
                <p className="mt-2 max-w-2xl text-sm leading-7 text-ink-2">{r.content}</p>
              )}
              <p className="mt-3 font-mono text-[11px] text-ink-3">ID {r.id.slice(0, 8).toUpperCase()}{r.authorName ? ` · 记录人 ${r.authorName}` : ""}</p>
              </div>
              <Link
                href={`/projects/${r.projectId}?space=record`}
                className="mt-3 inline-block text-xs leading-5 text-ink-3 underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-ink-3 sm:mt-0 sm:pt-1"
              >
                返回项目<br className="hidden sm:block" /> {r.projectName}
              </Link>
            </div>
          </li>
        ))}
        </ol>
      </div>
    </section>
  );
}

function formatArchiveDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date).replace("/", ".");
}
