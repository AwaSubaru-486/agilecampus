"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ITERATION_LABELS, type IterationStatus } from "@/lib/iteration-types";
import styles from "./iterations.module.css";

export function IterationStatusBadge({ status }: { status: IterationStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{ITERATION_LABELS[status]}</span>;
}
export function iterationDate(value: string) {
  return new Date(value).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
}
export function IterationDialog({ title, busy = false, close, children }: { title: string; busy?: boolean; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header className={styles.dialogHeader}><h3>{title}</h3><button type="button" className="ac-btn-ghost" aria-label="关闭弹窗" disabled={busy} onClick={close}>×</button></header>
    {children}
  </dialog>;
}
