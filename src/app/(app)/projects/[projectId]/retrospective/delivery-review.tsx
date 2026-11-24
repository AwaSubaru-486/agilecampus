"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import styles from "./retrospective.module.css";

export type ReflectionDelivery = {
  id: string;
  title: string;
  date: string | null;
  status: string;
  tone: "success" | "waiting" | "attention" | "neutral";
  submission: string | null;
  feedback: string | null;
  feedbackLabel?: string;
  recheck?: string | null;
  openHelp?: { id: string; detail: string }[];
  evidenceCount?: number;
  href: string;
};

const dateFormat = new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeZone: "Asia/Shanghai" });
const priority = { attention: 0, waiting: 1, success: 2, neutral: 3 };

export function DeliveryReview({ items, emptyHref, scope, children }: {
  items: ReflectionDelivery[];
  emptyHref: string;
  scope: "personal" | "team";
  children?: ReactNode;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const ordered = [...items].sort((a, b) => priority[a.tone] - priority[b.tone]);
  const current = ordered.find(item => item.id === selection) ?? ordered[0];
  return (
    <section id="reflection-delivery" aria-labelledby="reflection-delivery-title" className={`${styles.panel} ${styles.deliveryPanel}`}>
      <header className={styles.panelHeader}>
        <h3 id="reflection-delivery-title">交付与反馈</h3>
        {current && ordered.length > 1 && <label className={styles.selector}>
          <span>选择交付</span>
          <select value={current.id} onChange={event => setSelection(event.target.value)}>
            {ordered.map(item => <option key={item.id} value={item.id}>{item.title}（{item.status}）</option>)}
          </select>
        </label>}
      </header>
      {current ? <article className={styles.delivery} aria-live="polite">
        <header className={styles.deliveryHeader}>
          <h4>{current.title}</h4>
          <div className={styles.deliveryMeta}>
            <span className={`${styles.badge} ${styles[current.tone]}`}>{current.status}</span>
            {current.date && <time dateTime={current.date}>{dateFormat.format(new Date(current.date))}</time>}
            {Boolean(current.evidenceCount) && <span>{current.evidenceCount} 项交付材料</span>}
          </div>
        </header>
        <dl id="reflection-follow-up" className={styles.deliveryNotes}>
          <div><dt>{scope === "personal" ? "我提交了什么" : "交付了什么"}</dt><dd>{current.submission || "暂无可引用的交付说明。"}</dd></div>
          <div>
            <dt>{current.feedbackLabel ?? "验收意见"}</dt>
            <dd>{current.feedback || (current.tone === "waiting" ? "正在等待验收意见。" : "暂无文字意见。")}</dd>
            {current.recheck !== undefined && <><dt>导师复核意见</dt><dd>{current.recheck || "需要调整，暂无补充说明。"}</dd></>}
          </div>
        </dl>
        {!!current.openHelp?.length && <details key={current.id} className={styles.disclosure}>
          <summary>{current.openHelp.length} 条求助待处理</summary>
          <ul className={`${styles.disclosureBody} ${styles.helpList}`}>
            {current.openHelp.map(help => <li key={help.id}>{help.detail}</li>)}
          </ul>
        </details>}
        <Link className={styles.deliverySource} href={current.href}>打开原任务与证据 <span aria-hidden>↗</span></Link>
      </article> : <div className={styles.delivery}>
        <p className={styles.muted}>{scope === "personal" ? "你的任务提交交付或收到验收意见后，可以在这里回看。" : "项目有交付或验收记录后，会在这里显示。"}</p>
        <Link className={styles.sourceLink} href={emptyHref}>{scope === "personal" ? "查看我的任务" : "查看项目任务"} →</Link>
      </div>}
      {children}
    </section>
  );
}
