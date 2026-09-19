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
        <LibraryHeader countText="还没有可查看的资料" />
        <p className="mt-8 border-y border-stroke py-10 text-center text-sm text-ink-2">
          你还没有加入任何团队。
        </p>
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
    <div className="mx-auto max-w-[70rem] space-y-10">
      <LibraryHeader
        countText={
          rows.length === 0
            ? "还没有可复用的产出"
            : `${deliverables.length} 项成果 · ${docs.length} 份文档 · 跨全部项目`
        }
      />

      {rows.length === 0 ? (
        <p className="border-y border-stroke py-10 text-center text-sm text-ink-2">
          团队把代码仓库、数据集、答辩材料放进项目档案之后，会汇总到这里。
        </p>
      ) : (
        <>
          <EntryGroup title="成果" hint="交出来的东西" rows={deliverables} />
          <EntryGroup title="文档" hint="写下来的东西" rows={docs} />
        </>
      )}
    </div>
  );
}

function LibraryHeader({ countText }: { countText: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-5">
      <div>
        <p className="mb-2 text-xs font-medium text-ink-3">团队留下的可复用事实</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink">资料库</h1>
      </div>
      <p className="text-sm text-ink-2">{countText}</p>
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

function EntryGroup({ title, hint, rows }: { title: string; hint: string; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <header className="flex items-baseline justify-between gap-3 border-b border-stroke pb-2">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="text-xs text-ink-3">{hint} · {rows.length}</p>
      </header>
      <ul>
        {rows.map((r) => (
          <li key={r.id} className="group grid gap-3 border-b border-stroke py-5 sm:grid-cols-[6rem_1fr_auto] sm:items-start">
            <div className="flex items-center gap-2 pt-1 text-xs text-ink-3">
              <span className={`h-px w-5 ${r.type === "deliverable" ? "bg-human" : "bg-ink-3"}`} aria-hidden />
              <span>{ENTRY_LABEL[r.type]}</span>
            </div>
            <div className="min-w-0">
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline text-base font-medium text-ink underline decoration-stroke-strong underline-offset-4 transition-colors hover:text-human hover:decoration-human"
                >
                  {r.title} ↗
                </a>
              ) : (
                <span className="text-base font-medium text-ink">{r.title}</span>
              )}
              {r.content && (
                <p className="mt-2 line-clamp-2 max-w-2xl text-sm leading-6 text-ink-2">{r.content}</p>
              )}
            </div>
            <Link
              href={`/projects/${r.projectId}?space=record`}
              className="text-xs text-ink-3 underline decoration-transparent underline-offset-4 transition-colors hover:text-ink hover:decoration-ink-3 sm:pt-1"
            >
              {r.projectName}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
