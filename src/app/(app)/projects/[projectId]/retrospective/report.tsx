"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, useTransition } from "react";
import { generateProjectNotebook } from "./actions";
import type { Notebook, NotebookDelivery, NotebookPage } from "./notebook-data";
import { ReflectionNotes } from "./reflection-notes";
import styles from "./retrospective.module.css";
import book from "./notebook.module.css";

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" });

export function RetrospectiveReport({ projectId, personal, showScopeSwitch }: {
  projectId: string;
  personal: boolean;
  showScopeSwitch: boolean;
}) {
  const [report, setReport] = useState<Notebook | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const reportHref = `/projects/${projectId}/retrospective`;

  function generate() {
    setError("");
    startTransition(async () => {
      try {
        const result = await generateProjectNotebook(projectId, personal);
        if ("error" in result) setError(result.error);
        else setReport(result.report);
      } catch {
        setError("暂时无法生成复盘报告，请稍后重试。");
      }
    });
  }

  return (
    <div className={styles.workspace}>
      <header className={styles.hero}>
        <div className={styles.heroNav}>
          <Link href="/library" className={styles.backLink}><span aria-hidden>↖</span> 全部项目复盘</Link>
          {showScopeSwitch && <nav className={styles.scope} aria-label="复盘范围">
            <Link href={reportHref} aria-current={personal ? undefined : "page"}>团队复盘</Link>
            <Link href={`${reportHref}?scope=mine`} aria-current={personal ? "page" : undefined}>我的任务复盘</Link>
          </nav>}
        </div>
        <div className={styles.heroBody}>
          <div className={styles.heroTitle}>
            <h2>{personal ? "我的任务复盘" : "团队复盘"}</h2>
            <p className={book.coverIntro}>{personal ? "回看自己的交付与验收反馈。" : "先读总体评价，再逐页回看成员的交付与反馈。"}</p>
            <div className={book.coverActions}>
              <button type="button" data-tour="retrospective-generate" data-tour-report-ready={Boolean(report)} className={book.generate} disabled={pending} onClick={generate}>
                {pending ? "正在生成报告…" : report ? "重新生成报告" : "生成报告"} <span aria-hidden>↗</span>
              </button>
              {error && <p className={book.error} role="alert">{error}</p>}
            </div>
          </div>
          <div className={styles.heroArtwork} aria-hidden="true">
            <Image src="/retrospective-cover.webp" alt="" fill loading="eager" fetchPriority="high"
              sizes="(max-width: 660px) 100vw, (max-width: 1120px) 40vw, 490px" />
          </div>
        </div>
      </header>
      {report && <NotebookView report={report} />}
    </div>
  );
}

function NotebookView({ report }: { report: Notebook }) {
  const [selection, setSelection] = useState({ edition: report.generatedAt, index: 0 });
  const index = selection.edition === report.generatedAt ? selection.index : 0;
  const page = report.pages[index];
  const notebook = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const archive = page.archive ?? [];

  useEffect(() => {
    notebook.current?.scrollIntoView({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [index, report.generatedAt]);

  function turn(target: number) {
    setSelection({ edition: report.generatedAt, index: target });
  }

  return (
    <section className={book.notebook} ref={notebook} aria-label={`${report.projectName}复盘报告`}>
      <div className={book.spread}>
        <aside className={book.index}>
          <header className={book.indexHeader}>
            <h3>报告目录</h3>
            <p>{report.projectName}</p>
          </header>
          <nav aria-label="报告目录">
            <ol>
              {report.pages.map((item, itemIndex) => (
                <li key={item.id}>
                  <button type="button" aria-current={index === itemIndex ? "page" : undefined} onClick={() => turn(itemIndex)}>
                    <span className={book.indexNumber}>{String(itemIndex + 1).padStart(2, "0")}</span>
                    <span className={book.indexName}>{item.title}</span>
                    {item.role && <span className={book.indexRole}>{item.role}</span>}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <time dateTime={report.generatedAt} className={book.generatedDate}>生成于 {dateFormat.format(new Date(report.generatedAt))}</time>
        </aside>
        <div className={book.binding} aria-hidden="true" />
        <div className={book.paper}>
          <article className={book.sheet} key={`${report.generatedAt}:${page.id}`} aria-labelledby="notebook-page-title">
            <header className={book.sheetHeader}>
              <div>
                <p className={book.label}>{page.role ?? (report.personal ? "个人报告" : "团队报告")}</p>
                <h3 tabIndex={-1} ref={heading} id="notebook-page-title">{page.title}</h3>
              </div>
              <p className={book.pageNumber}>{String(index + 1).padStart(2, "0")} <span>/ {String(report.pages.length).padStart(2, "0")}</span></p>
            </header>
            <nav aria-label="报告翻页" data-tour="retrospective-pages" data-tour-member-view={index > 0 || report.pages.length === 1} className={book.pager}>
              <button type="button" disabled={index === 0} onClick={() => turn(index - 1)}>← 上一页</button>
              <button type="button" disabled={index === report.pages.length - 1} onClick={() => turn(index + 1)}>下一页 →</button>
            </nav>
            <p data-tour="retrospective-summary" className={book.evaluation}>{page.evaluation}</p>
            <dl className={book.reportMetrics}>
              {page.metrics.map(metric => <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>)}
            </dl>
            <section data-tour="retrospective-action" className={book.nextAction}>
              <h4>下一步</h4><p>{page.nextAction}</p>
            </section>
            <NotebookRecords page={page} />
            {archive.length > 0 && <details className={styles.disclosure}>
              <summary>归档材料 <span className={book.count}>{archive.length} 项</span></summary>
              <ul className={`${styles.disclosureBody} ${book.sourceList}`}>
                {archive.map(source => <li key={source.href}><Link href={source.href} className={styles.sourceLink}>{source.title} ↗</Link></li>)}
              </ul>
            </details>}
          </article>
          <div hidden={index !== 0}>
            <details className={`${styles.disclosure} ${book.notes}`}>
              <summary>我的复盘笔记</summary>
              <ReflectionNotes key={report.draftKey} draftKey={report.draftKey} projectName={report.projectName} scope={report.personal ? "personal" : "team"} />
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}

function NotebookRecords({ page }: { page: NotebookPage }) {
  return (
    <>
      {!!page.highlights?.length && <section className={book.records}>
        <h4>代表成果</h4>
        <ul className={book.sourceList}>{page.highlights.map(source => <li key={source.href}><Link href={source.href} className={styles.sourceLink}>{source.title} ↗</Link></li>)}</ul>
      </section>}
      {page.deliveries && <section className={book.records}>
        <h4>交付与反馈 <span className={book.count}>{page.deliveries.length} 项</span></h4>
        {page.deliveries.length
          ? page.deliveries.map((item, index) => <Delivery key={item.id} item={item} open={index === 0} />)
          : <p className={styles.muted}>暂无可回看的个人交付记录。</p>}
      </section>}
      {!!page.followUps?.length && <section className={book.records}>
        <h4>待跟进</h4>
        <ul className={book.followList}>{page.followUps.map((item, index) => <li key={`${item.href}:${index}`}>
          <Link href={item.href} className={styles.sourceLink}>{item.title} ↗</Link><p>{item.text}</p>
        </li>)}</ul>
      </section>}
    </>
  );
}

function Delivery({ item, open }: { item: NotebookDelivery; open: boolean }) {
  return <details className={styles.disclosure} open={open}>
    <summary><span className={book.deliveryTitle}>{item.title}</span><span className={`${styles.badge} ${styles[item.tone]}`}>{item.status}</span></summary>
    <div className={styles.disclosureBody}>
      <dl className={styles.deliveryNotes}>
        <div><dt>交付说明</dt><dd>{item.submission || "暂无可引用的交付说明。"}</dd></div>
        <div><dt>{item.feedbackLabel}</dt><dd>{item.feedback || (item.tone === "waiting" ? "正在等待验收意见。" : "暂无文字意见。")}</dd></div>
      </dl>
      <Link href={item.href} className={styles.sourceLink}>查看原任务{item.evidenceCount ? `与 ${item.evidenceCount} 项交付材料` : ""} ↗</Link>
    </div>
  </details>;
}
