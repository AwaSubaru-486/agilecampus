import Link from "next/link";
import type { IterationOutcome } from "@/lib/iteration-types";
import { iterationDate } from "./iteration-ui";
import styles from "./iterations.module.css";

export function OutcomeCard({ projectId, outcome }: { projectId: string; outcome: IterationOutcome }) {
  return <article className={`${styles.featureCard} ${styles.outcomeCard}`}>
    <time dateTime={outcome.acceptedAt}>{iterationDate(outcome.acceptedAt)} 验收通过</time>
    <h3>{outcome.title}</h3>
    <p>{outcome.summary}</p>
    <footer>
      <Link className={styles.textLink} href={`/projects/${projectId}?space=work&scope=all&task=${outcome.taskId}`} prefetch={false}>查看验收来源</Link>
      {outcome.resultUrl && <a className={styles.textLink} href={outcome.resultUrl} target="_blank" rel="noreferrer">打开交付链接 ↗</a>}
    </footer>
  </article>;
}
