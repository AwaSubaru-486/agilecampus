import { useState } from "react";
import { iterationModules } from "@/lib/iteration-modules";
import { FEATURE_CHANGE_LABELS, type IterationView } from "@/lib/iteration-types";
import { iterationDate } from "./iteration-ui";
import styles from "./iterations.module.css";

export function ReleaseShowcase({ releases, hasOutcomes, openVersion }: {
  releases: IterationView[];
  hasOutcomes: boolean;
  openVersion: (version: IterationView) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const latest = releases[0];
  const selected = releases.find(version => version.id === selectedId) ?? latest;
  if (!selected) return <section className={styles.showcase} aria-labelledby="release-change-title">
    <div className={styles.showcaseHeader}>
      <div><h2 id="release-change-title">首个版本尚未归档</h2><p className={styles.showcaseSummary}>验收后的交付成果会自动显示在下方。</p></div>
      {hasOutcomes && <a className={styles.showcaseAction} href="#iteration-pending">查看已验收成果 <span aria-hidden>↓</span></a>}
    </div>
  </section>;

  return <section className={styles.showcase} aria-labelledby="release-change-title">
    {releases.length > 1 && <nav className={styles.releasePicker} aria-label="切换归档版本">
      {releases.map(version => <button type="button" key={version.id} aria-pressed={version.id === selected.id}
        aria-label={`${version.version} · ${version.title}`} onClick={() => setSelectedId(version.id)}>
        <strong>{version.version}</strong><span>{version.id === latest.id ? "最新" : iterationDate(version.releasedAt ?? version.createdAt)}</span>
      </button>)}
    </nav>}
    <VersionComparison key={selected.id} version={selected} releases={releases} openVersion={openVersion} />
  </section>;
}

function VersionComparison({ version, releases, openVersion }: {
  version: IterationView;
  releases: IterationView[];
  openVersion: (version: IterationView) => void;
}) {
  const [changeId, setChangeId] = useState<string | null>(null);
  const base = releases.find(item => item.id === version.baseIterationId);
  const features = version.features;
  const choices = features.length
    ? features.map(feature => ({ id: feature.id, title: feature.name }))
    : version.outcomeSnapshot.map(outcome => ({ id: outcome.taskId, title: outcome.title }));
  const selectedChange = choices.find(item => item.id === changeId) ?? choices[0];
  const feature = features.find(item => item.id === selectedChange?.id);
  const outcome = feature ? undefined : version.outcomeSnapshot.find(item => item.taskId === selectedChange?.id);
  const currentModules = iterationModules(version, releases);
  const currentModule = currentModules.find(item => item.id === feature?.id) ?? currentModules.find(item => item.name === feature?.name);
  const priorModule = iterationModules(base, releases).find(item => item.id === currentModule?.id);
  const previousSummary = priorModule?.summary ?? (base && (base.features[0]?.summary || base.outcomeSnapshot[0]?.summary || base.releaseNotes));
  const first = version.id === releases.at(-1)?.id;
  const date = version.releasedAt ?? version.createdAt;
  const hasProof = version.outcomeSnapshot.length > 0;

  return <>
    <div className={styles.showcaseHeader}>
      <div>
        <div className={styles.showcaseMeta}><strong>{version.version}</strong><time dateTime={date}>{iterationDate(date)} 归档</time></div>
        <h2 id="release-change-title">{version.title}</h2>
      </div>
      <button className={styles.showcaseAction} type="button" onClick={() => openVersion(version)}>
        {hasProof ? "版本详情与验收依据" : "查看版本详情"} <span aria-hidden>↗</span>
      </button>
    </div>
    {selectedChange ? <div className={styles.releaseComparison}>
      <div className={styles.comparisonToolbar}>
        <h3>{base ? "与基准版本对比" : first && feature ? "首版能力" : "本版成果"}</h3>
        {choices.length > 1 && <label>本版变化<select value={selectedChange.id} onChange={event => setChangeId(event.target.value)}>
          {choices.map(choice => <option key={choice.id} value={choice.id}>{choice.title}</option>)}
        </select></label>}
      </div>
      <div className={base ? styles.capabilityComparison : undefined}>
        {base && <><div className={styles.previousCapabilityPane}>
          <span className={styles.comparisonLabel}>{base.version} · {priorModule ? "原有能力" : "基准版本"}</span>
          <h4>{priorModule?.name ?? base.title}</h4>
          {previousSummary && <p>{previousSummary}</p>}
        </div>
        <span className={styles.comparisonArrow} aria-hidden /></>}
        <div className={styles.currentCapabilityPane}>
          <span className={styles.comparisonLabel}>{version.version} · {feature ? FEATURE_CHANGE_LABELS[feature.change] : "已验收"}</span>
          <h4>{selectedChange.title}</h4>
          <p>{feature?.summary ?? outcome?.summary}</p>
          {currentModule?.resultUrl && <a className={styles.textLink} href={currentModule.resultUrl} target="_blank" rel="noreferrer">打开本项成果 ↗</a>}
        </div>
      </div>
    </div> : version.releaseNotes && <p className={styles.showcaseSummary}>{version.releaseNotes}</p>}
  </>;
}
