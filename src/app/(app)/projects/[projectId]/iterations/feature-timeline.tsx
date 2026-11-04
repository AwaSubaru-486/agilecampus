"use client";

import { useRef } from "react";
import { FEATURE_CHANGE_LABELS, type IterationView } from "@/lib/iteration-types";
import { iterationDate } from "./iteration-ui";
import styles from "./iterations.module.css";

export function FeatureTimeline({ releases, openVersion }: { releases: IterationView[]; openVersion: (version: IterationView) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const ordered = [...releases].sort((a, b) => (a.releasedAt ?? a.createdAt).localeCompare(b.releasedAt ?? b.createdAt));
  return <section aria-labelledby="feature-evolution-title" className={styles.timelinePanel}>
    <header className={styles.sectionHeader}>
      <div><p className={styles.eyebrow}>01 / 已实现的功能</p><h2 id="feature-evolution-title">功能演进</h2><p className={styles.muted}>沿着版本回看，项目一步步具备了哪些能力。</p></div>
      <div className={styles.timelineControls}><span>{releases.length} 个已发布版本</span>{releases.length > 1 && <><button aria-label="查看更早版本" onClick={() => viewport.current?.scrollBy({ left: -300, behavior: "smooth" })}>←</button><button aria-label="查看更新版本" onClick={() => viewport.current?.scrollBy({ left: 300, behavior: "smooth" })}>→</button></>}</div>
    </header>
    {ordered.length ? <div ref={viewport} className={styles.timelineViewport} tabIndex={0} role="region" aria-label="已发布功能时间线，可左右滚动">
      <ol className={styles.releaseColumns}>
        {ordered.map((version, index) => <li className={styles.releaseColumn} key={version.id}>
          <div className={styles.versionHead}>
            <button onClick={() => openVersion(version)} aria-label={`查看 ${version.version} 发布详情`}><span className={styles.versionNumber}>{version.version}</span>{index === ordered.length - 1 && <span className={styles.latest}>最新发布</span>}<strong>{version.title}</strong><time dateTime={version.releasedAt ?? version.createdAt}>{iterationDate(version.releasedAt ?? version.createdAt)}</time></button>
            <span className={styles.versionDot} aria-hidden />
          </div>
          <ul className={styles.featureSpine} aria-label={`${version.version} 已实现的功能模块`}>
            {version.features.map(feature => {
              const previous = ordered.slice(0, index).reverse().find(row => row.features.some(item => item.id === feature.id || item.name.toLowerCase() === feature.name.toLowerCase()));
              return <li key={feature.id} className={styles.featureBranch}>
                <div className={styles.featureCard}><span className={`${styles.changeLabel} ${styles[feature.change]}`}>{FEATURE_CHANGE_LABELS[feature.change]}</span><h3>{feature.name}</h3><p>{feature.summary}</p>{previous && <button className={styles.featureLineage} onClick={() => openVersion(previous)}>接续 {previous.version} 的同一模块 ↗</button>}</div>
              </li>;
            })}
            {!version.features.length && <li className={styles.featureBranch}><div className={styles.legacyNote}>该历史版本尚未记录模块级功能。<button onClick={() => openVersion(version)}>查看原有版本说明 →</button></div></li>}
          </ul>
        </li>)}
      </ol>
    </div> : <div className={styles.emptyTimeline}>
      <div className={styles.emptyDiagram} aria-hidden><span className={styles.emptyVersion}>首个版本</span><i /><span /><span /><span /></div>
      <div><h3>把每次交付，连成产品的演进</h3><p>发布版本后，已实现的功能模块会沿同一条竖线展开。<br />这里逐版记录新增、完善与修复的能力。</p></div>
    </div>}
    <footer className={styles.timelineFooter}><span><i className={styles.legendDot} />同一竖线上的模块属于同一个版本</span><div><span className={styles.added}>新增</span><span className={styles.improved}>完善</span><span className={styles.fixed}>修复</span></div></footer>
  </section>;
}
