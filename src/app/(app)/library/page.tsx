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
        <h1 className="font-display text-2xl font-bold text-ink">资料库</h1>
        <p className="ac-card mt-4 p-8 text-center text-sm text-ink-2">
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
    <div className="mx-auto max-w-[70rem] space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-ink">资料库</h1>
        <p className="mt-1 text-sm text-ink-2">
          {rows.length === 0
            ? "还没有可复用的产出。"
            : `${deliverables.length} 项成果、${docs.length} 份文档，跨全部项目汇总。`}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="ac-card p-8 text-center text-sm text-ink-2">
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
    <section className="ac-card overflow-hidden">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-stroke px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="text-xs text-ink-3">{hint}</p>
      </header>
      <ul className="divide-y divide-stroke">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <p className="flex flex-wrap items-baseline gap-2">
              <span className={`ac-badge ${r.type === "deliverable" ? "bg-signal-soft text-signal" : "bg-sunken text-ink-3"}`}>
                {ENTRY_LABEL[r.type]}
              </span>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-ink hover:text-signal hover:underline"
                >
                  {r.title} ↗
                </a>
              ) : (
                <span className="text-sm font-medium text-ink">{r.title}</span>
              )}
              <Link
                href={`/projects/${r.projectId}?space=record`}
                className="text-xs text-ink-3 hover:text-signal"
              >
                {r.projectName}
              </Link>
            </p>
            {r.content && (
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-2">{r.content}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
