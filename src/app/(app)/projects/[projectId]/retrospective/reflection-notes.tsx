"use client";

import { useEffect, useState } from "react";
import styles from "./retrospective.module.css";

const prompts = [
  { key: "keep", name: "哪件事做得有效", prompt: "写一个做法，并记下它带来的结果。" },
  { key: "improve", name: "哪里容易卡住", prompt: "回想一次卡住或返工，写下当时缺了什么。" },
  { key: "tryNext", name: "下次先试什么", prompt: "写一件能马上开始、做完可以核对的事。" },
] as const;
const [keep, improve, nextStep] = prompts;
const empty = { keep: "", improve: "", tryNext: "" };
const maxLength = 1200;

export function ReflectionNotes({ draftKey, projectName, scope }: { draftKey: string; projectName: string; scope: "personal" | "team" }) {
  const [ready, setReady] = useState(false);
  const [notes, setNotes] = useState(empty);
  const [stored, setStored] = useState(empty);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const parsed: unknown = JSON.parse(saved);
          if (parsed && typeof parsed === "object") {
            const record = parsed as Record<string, unknown>;
            const next = { ...empty };
            for (const { key } of prompts) {
              const value = record[key];
              if (typeof value === "string") next[key] = value.slice(0, maxLength);
            }
            setNotes(next);
            setStored(next);
          }
        }
      } catch {
        setMessage("暂时无法读取浏览器中的笔记，仍可填写和复制。");
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [draftKey]);

  const hasNotes = prompts.some(({ key }) => notes[key].trim());
  const dirty = prompts.some(({ key }) => notes[key] !== stored[key]);
  const hasExtraNotes = Boolean(notes.keep.trim() || notes.improve.trim());

  function noteField({ key, name, prompt }: (typeof prompts)[number]) {
    return <label className={styles.noteField} key={key}>
      <span>{name}</span>
      <textarea value={notes[key]} placeholder={prompt} maxLength={maxLength} onChange={event => {
        setNotes({ ...notes, [key]: event.target.value });
        setMessage("");
      }} />
    </label>;
  }

  function save() {
    try {
      localStorage.setItem(draftKey, JSON.stringify(notes));
      setStored(notes);
      setMessage("笔记已保存在此浏览器。");
    } catch {
      setMessage("保存失败，可以先复制本次笔记。");
    }
  }

  async function copy() {
    const heading = scope === "personal" ? "个人复盘" : "项目复盘";
    const text = [`${projectName} · ${heading}`, ...prompts.flatMap(({ key, name }) => notes[key].trim() ? [`${name}\n${notes[key].trim()}`] : [])].join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setMessage("复盘笔记已复制。");
    } catch {
      setMessage("复制失败，请选中需要的文字手动复制。");
    }
  }

  return (
    <section id="reflection-notes" className={`${styles.panel} ${styles.notesPanel}`} aria-labelledby="reflection-notes-title">
      <header className={styles.panelHeader}><h3 id="reflection-notes-title">写下下一步</h3><span className={styles.localDraft}>笔记保存在此浏览器</span></header>
      <form onSubmit={event => { event.preventDefault(); save(); }}>
        <fieldset disabled={!ready} className={styles.noteForm}>
          {noteField(nextStep)}
          <details className={styles.disclosure}>
            <summary>补充复盘笔记{hasExtraNotes && <span className={styles.disclosureHint}>已填写</span>}</summary>
            <div className={`${styles.disclosureBody} ${styles.noteFields}`}>
              {[keep, improve].map(noteField)}
            </div>
          </details>
        </fieldset>
        <div className={styles.noteFooter}>
          <button type="submit" className={styles.saveNote} disabled={!ready || !dirty}>保存笔记</button>
          <button type="button" className={styles.copyNote} disabled={!ready || !hasNotes} onClick={copy}>复制笔记</button>
          <span role="status">{message || (dirty ? "有改动待保存" : "")}</span>
        </div>
      </form>
    </section>
  );
}
