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
export default async function LibraryPage({
  searchParams,
}: {
  searchParams?: Promise<{ type?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = searchParams ? await searchParams : {};
  const selectedType = sp.type === "deliverable" || sp.type === "doc" ? sp.type : "all";

  const memberships = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, session.user.id));
  const teamIds = memberships.map((m) => m.teamId);

  if (teamIds.length === 0) {
    return (
      <div className="mx-auto max-w-[70rem]">
        <LibraryHeader total={0} deliverableCount={0} docCount={0} activeType="all" />
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

  const displayRows =
    selectedType === "deliverable"
      ? deliverables
      : selectedType === "doc"
        ? docs
        : rows;

  return (
    <div className="mx-auto max-w-[74rem] space-y-2">
      <LibraryHeader
        total={rows.length}
        deliverableCount={deliverables.length}
        docCount={docs.length}
        activeType={selectedType}
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
        <ArchiveLedger rows={displayRows} totalCount={rows.length} activeType={selectedType} />
      )}
    </div>
  );
}

function LibraryHeader({
  total,
  deliverableCount,
  docCount,
  activeType,
}: {
  total: number;
  deliverableCount: number;
  docCount: number;
  activeType: "all" | "deliverable" | "doc";
}) {
  return (
    <header className="grid border-b-2 border-ink lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="py-6 sm:py-9">
        <p className="text-xs font-medium tracking-[0.08em] text-ink-3">项目索引</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">资料库</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink-2">团队成果与项目文档的统一索引，保留每条记录的出处。</p>
      </div>
      <dl className="grid grid-cols-3 border-t border-stroke text-left lg:border-l lg:border-t-0">
        <Link
          href="/library"
          aria-label={`查看全部归档：共 ${total} 项`}
          aria-current={activeType === "all" ? "true" : undefined}
          className={`group flex flex-col justify-end border-r border-stroke px-3 py-4 transition-colors hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal lg:px-4 lg:py-6 ${
            activeType === "all" ? "bg-sunken/50" : ""
          }`}
        >
          <dt className="text-xs text-ink-3 group-hover:text-ink">全部</dt>
          <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {String(total).padStart(2, "0")}
          </dd>
          {activeType === "all" && <span className="mt-2 block h-0.5 w-6 bg-ink" />}
        </Link>

        <Link
          href="/library?type=deliverable"
          aria-label={`只看可交付成果：共 ${deliverableCount} 项`}
          aria-current={activeType === "deliverable" ? "true" : undefined}
          className={`group flex flex-col justify-end border-r border-stroke px-3 py-4 transition-colors hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal lg:px-4 lg:py-6 ${
            activeType === "deliverable" ? "bg-sunken/50" : ""
          }`}
        >
          <dt className="text-xs text-ink-3 group-hover:text-ink">成果</dt>
          <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-human">
            {String(deliverableCount).padStart(2, "0")}
          </dd>
          {activeType === "deliverable" && <span className="mt-2 block h-0.5 w-6 bg-human" />}
        </Link>

        <Link
          href="/library?type=doc"
          aria-label={`只看过程文档：共 ${docCount} 项`}
          aria-current={activeType === "doc" ? "true" : undefined}
          className={`group flex flex-col justify-end px-3 py-4 transition-colors hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-signal lg:px-4 lg:py-6 ${
            activeType === "doc" ? "bg-sunken/50" : ""
          }`}
        >
          <dt className="text-xs text-ink-3 group-hover:text-ink">文档</dt>
          <dd className="mt-1 font-display text-2xl font-semibold tabular-nums text-ink">
            {String(docCount).padStart(2, "0")}
          </dd>
          {activeType === "doc" && <span className="mt-2 block h-0.5 w-6 bg-ink" />}
        </Link>
      </dl>
    </header>
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

function ArchiveLedger({
  rows,
  totalCount,
  activeType,
}: {
  rows: Row[];
  totalCount: number;
  activeType: "all" | "deliverable" | "doc";
}) {
  return (
    <section className="grid lg:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="border-b border-stroke py-6 lg:border-b-0 lg:border-r lg:py-8 lg:pr-7">
        <p className="text-xs font-medium tracking-[0.08em] text-ink-3">索引视图</p>
        <p className="mt-2 max-w-[10rem] text-sm leading-6 text-ink-2">
          按记录时间倒序排列，项目出处始终可回溯。
        </p>
        <div className="mt-6 hidden space-y-2 border-l-2 border-stroke-strong pl-3 text-xs leading-5 text-ink-3 lg:block">
          <p className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 bg-human" />
            <span>可交付成果</span>
          </p>
          <p className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 bg-ink-3" />
            <span>过程文档</span>
          </p>
        </div>
      </aside>

      <div className="lg:pl-9">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">
              {activeType === "deliverable"
                ? "成果归档"
                : activeType === "doc"
                  ? "过程文档"
                  : "归档记录"}
            </h2>
            <span className="font-mono text-xs text-ink-3">({rows.length})</span>
          </div>
          {activeType !== "all" && (
            <Link
              href="/library"
              className="rounded-[var(--radius-control)] text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              清除筛选，查看全部 {totalCount} 项 →
            </Link>
          )}
        </header>

        {rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-ink-3">
            <p>该分类下暂无归档记录。</p>
            <Link
              href="/library"
              className="mt-2 inline-block rounded-[var(--radius-control)] text-xs text-signal hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
            >
              查看全部记录 →
            </Link>
          </div>
        ) : (
          <ol className="divide-y divide-stroke">
            {rows.map((r) => (
              <li
                key={r.id}
                className="group grid gap-3 py-5 transition-colors hover:bg-sunken/30 sm:grid-cols-[5.75rem_minmax(0,1fr)] sm:gap-5"
              >
                <div className="pt-1 text-xs text-ink-3">
                  <time dateTime={r.createdAt.toISOString()} className="block tabular-nums">
                    {formatArchiveDate(r.createdAt)}
                  </time>
                  <span
                    className={`mt-2 block h-0.5 w-8 rounded-full ${
                      r.type === "deliverable" ? "bg-human" : "bg-ink-3"
                    }`}
                    aria-hidden
                  />
                  <span className="mt-1.5 block font-medium text-ink-2">{ENTRY_LABEL[r.type]}</span>
                </div>
                <div className="min-w-0 sm:grid sm:grid-cols-[minmax(0,1fr)_10.5rem] sm:gap-6">
                  <div>
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline text-base font-semibold leading-7 text-ink underline decoration-stroke-strong underline-offset-4 transition-colors hover:text-signal hover:decoration-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal rounded-[var(--radius-control)]"
                      >
                        {r.title}
                        <span aria-hidden className="ml-1 text-xs text-ink-3">↗</span>
                      </a>
                    ) : (
                      <span className="text-base font-semibold leading-7 text-ink">{r.title}</span>
                    )}
                    {r.content && (
                      <p className="mt-1.5 max-w-2xl text-sm leading-6 text-ink-2">{r.content}</p>
                    )}
                    <p className="mt-2.5 font-mono text-[11px] text-ink-3">
                      ID {r.id.slice(0, 8).toUpperCase()}
                      {r.authorName ? ` · 记录人 ${r.authorName}` : ""}
                    </p>
                  </div>
                  <div className="mt-2 sm:mt-0 sm:pt-1">
                    <Link
                      href={`/projects/${r.projectId}?space=record`}
                      aria-label={`返回项目：${r.projectName}`}
                      className="inline-block rounded-[var(--radius-control)] text-xs leading-5 text-ink-3 underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                    >
                      返回项目
                      <br className="hidden sm:block" /> {r.projectName} →
                    </Link>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function formatArchiveDate(date: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date).replace("/", ".");
}
