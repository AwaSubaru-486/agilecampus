"use client";

import { useState } from "react";
import Link from "next/link";
import {
  EXAMPLE_FIELDS,
  EXAMPLE_FLOW,
  type ExampleState,
} from "@/lib/tutorials/example-flow";
import { completeExampleStep } from "../actions";

const BUTTONS = [
  "准备好团队",
  "创建示例项目",
  "生成示例任务",
  "保存任务与分工",
  "确认发布任务",
  "确认接住任务",
  "发送给教学 AI",
  "登记求助",
  "登记共享资源",
  "提交待验收",
  "通过任务验收",
  "提交阶段集成",
  "通过集成审核",
  "生成下一轮任务",
];
const ROLES = [
  "组长",
  "组长",
  "组长",
  "组长",
  "组长",
  "组员",
  "组员",
  "组员",
  "组员",
  "组员",
  "导师",
  "组长",
  "导师",
  "组长",
];
const STAGES = [
  { name: "准备项目", from: 0, to: 1 },
  { name: "规划任务", from: 2, to: 4 },
  { name: "执行交付", from: 5, to: 9 },
  { name: "验收迭代", from: 10, to: 13 },
  { name: "项目成果", from: 14, to: 14 },
];

export function ExampleWorkspace({
  initial,
  requestedPhase,
}: {
  initial: ExampleState;
  requestedPhase: number;
}) {
  const [sample, setSample] = useState(initial);
  const phase = Math.max(
    0,
    Math.min(
      Number.isInteger(requestedPhase) ? requestedPhase : sample.phase,
      sample.phase,
      14,
    ),
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-24">
      <header className="border-b border-stroke pb-6">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-full bg-signal-soft px-3 py-1 font-semibold text-signal">
            教学示例练习区
          </span>
          <span className="text-ink-3">进度自动保存，无需模型配置</span>
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {sample.values.project || "从一个校园活动报名页开始"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-3">
          {sample.values.team || "你的第一个协作团队"}，第 1 轮
          {sample.phase === 14
            ? "已完成，下一轮已规划"
            : "：把需求变成可验收的成果"}
        </p>
      </header>
      <nav aria-label="示例项目流程" className="flex flex-wrap gap-2">
        {STAGES.map((stage) => (
          <Link
            key={stage.name}
            href={
              stage.from <= sample.phase
                ? `/tutorials/example?phase=${Math.min(Math.max(phase, stage.from), stage.to, sample.phase)}`
                : "#"
            }
            aria-disabled={stage.from > sample.phase}
            className={`rounded-lg px-3 py-2 text-xs ${phase >= stage.from && phase <= stage.to ? "bg-signal text-white" : stage.from <= sample.phase ? "bg-panel text-ink-2" : "bg-sunken text-ink-3 pointer-events-none"}`}
          >
            {sample.phase > stage.to ? "✓ " : ""}
            {stage.name}
          </Link>
        ))}
      </nav>
      {phase === 14 ? (
        <section
          data-tour="example-records"
          className="ac-focus-card max-w-2xl p-6"
        >
          <span className="text-xs font-semibold text-success">
            一轮协作完成
          </span>
          <h2 className="mt-2 text-xl font-semibold text-ink">
            你做出了哪些成果？
          </h2>
          <dl className="mt-5 space-y-4 text-sm">
            {[
              ["项目目标", sample.values.brief],
              [
                "任务与负责人",
                `${sample.values.task}（${sample.values.assignee}负责）`,
              ],
              ["执行计划", sample.values.commitment],
              ["AI 提问", sample.values.question],
              ["协作求助", sample.values.blocker],
              ["共享资源", sample.values.resource],
              ["交付证据", sample.values.evidence],
              ["任务验收", sample.values.review],
              ["阶段集成", sample.values.integration],
              ["集成审核", sample.values.approval],
              ["下一轮需求", sample.values.improvement],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="mt-1 break-words leading-6 text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-5 border-t border-stroke pt-4">
            <summary className="cursor-pointer text-sm text-signal">
              查看完整操作记录（{sample.events.length} 项）
            </summary>
            <ol className="mt-3 space-y-2 text-xs text-ink-3">
              {sample.events.map((event) => (
                <li key={event.phase}>
                  {event.phase + 1}. {event.title} ✓
                </li>
              ))}
            </ol>
          </details>
          <p className="mt-5 rounded-lg bg-sunken p-3 text-xs leading-5 text-ink-3">
            正式项目继续使用你真实的团队身份。前往教程目录可针对特定功能再练；创建或加入团队后，就能在真实项目中应用这条流程。
          </p>
        </section>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,650px)_1fr]">
          <PhaseForm
            key={phase}
            phase={phase}
            sample={sample}
            onSaved={setSample}
          />
          <aside className="space-y-4 lg:sticky lg:top-6">
            <section className="ac-focus-card p-5">
              <h2 className="text-sm font-semibold text-ink">
                同一个项目，三种分工
              </h2>
              <div className="mt-4 space-y-3 text-xs leading-5 text-ink-3">
                {[
                  ["组长", "整理需求、分配任务、协调阻塞、组织集成"],
                  ["组员", "接住任务、执行协作、提交交付证据"],
                  ["导师", "验收任务、审核集成、提出改进反馈"],
                ].map(([role, description]) => (
                  <p key={role}>
                    <strong
                      className={
                        ROLES[phase] === role ? "text-signal" : "text-ink-2"
                      }
                    >
                      {role}
                      {ROLES[phase] === role ? "（当前演练）" : ""}
                    </strong>
                    <br />
                    {description}
                  </p>
                ))}
              </div>
              <p className="mt-4 border-t border-stroke pt-3 text-[11px] leading-5 text-ink-3">
                角色切换只用于此教学示例，不改变你的账号权限，也不会联系真实成员。
              </p>
            </section>
            <section className="ac-focus-card p-5">
              <h2 className="text-sm font-semibold text-ink">当前项目状态</h2>
              <p className="mt-3 text-xs leading-6 text-ink-3">
                {sample.phase < 2
                  ? "先准备团队，再创建项目。"
                  : sample.phase < 3
                    ? "项目已建立，等待需求。"
                    : sample.phase < 5
                      ? "任务草案待确认发布。"
                      : sample.phase < 6
                        ? "任务已发布，等待负责人接住。"
                        : sample.phase < 10
                          ? "任务执行中，交付时需要附上证据。"
                          : sample.phase < 11
                            ? "成果待导师验收。"
                            : sample.phase < 13
                              ? "任务已验收，阶段集成仍需审核。"
                              : "本轮集成已通过，可以规划下一轮。"}
              </p>
              {sample.phase >= 3 && (
                <div className="mt-3 rounded-lg border border-stroke p-3">
                  <p className="text-xs font-medium text-ink">
                    {sample.values.task || "实现报名表单与必填校验"}
                  </p>
                  <p className="mt-2 text-[11px] text-ink-3">
                    负责人：{sample.values.assignee || "待确认示例组员"}
                  </p>
                  <p className="mt-2 text-[11px] leading-5 text-ink-3">
                    完成条件：必填缺失时提示，信息完整时可以提交。
                  </p>
                  {sample.phase >= 5 && (
                    <p className="mt-3 border-t border-stroke pt-3 text-[11px] leading-5 text-ink-3">
                      另一项任务：核对活动说明与截止时间，由示例组长负责
                      <br />
                      {sample.phase >= 8
                        ? "✓ 已确认规则（教学演示）"
                        : "等待规则确认"}
                    </p>
                  )}
                </div>
              )}
            </section>
          </aside>
        </div>
      )}
      <Link href="/tutorials" className="inline-block text-xs text-signal">
        ← 返回教程目录（已完成的操作会保留）
      </Link>
    </div>
  );
}

function PhaseForm({
  phase,
  sample,
  onSaved,
}: {
  phase: number;
  sample: ExampleState;
  onSaved: (state: ExampleState) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const done = sample.phase > phase;
  return (
    <section
      data-tour={`example-${phase}`}
      data-tour-complete={done ? "true" : "false"}
      className="ac-focus-card p-5 sm:p-7"
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-signal">
          {ROLES[phase]}工作台（教学演练）
        </span>
        <span className="text-ink-3">操作 {phase + 1} / 14</span>
      </div>
      <h2 className="mt-3 text-xl font-semibold text-ink">
        {EXAMPLE_FLOW[phase][1]}
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-3">
        {EXAMPLE_FLOW[phase][2]}
      </p>
      {phase === 3 && (
        <div className="mt-4 rounded-lg bg-sunken p-3 text-xs leading-6 text-ink-2">
          <strong>草案：2 项任务</strong>
          <p>① 实现报名表单与必填校验 → 示例组员</p>
          <p>② 核对活动说明与截止时间 → 示例组长</p>
          <p className="text-ink-3">
            先调整第 ① 项。可使用下面的样例值，并修改成你认为清晰的分工。
          </p>
        </div>
      )}
      {phase === 4 && (
        <div className="mt-4 rounded-lg bg-sunken p-3 text-sm leading-6 text-ink-2">
          <p>
            {sample.values.task} → {sample.values.assignee}
          </p>
          <p>核对活动说明与截止时间 → 示例组长</p>
          <p className="mt-2 text-xs text-ink-3">
            这两项将进入示例项目的执行列表。
          </p>
        </div>
      )}
      {phase === 10 && (
        <p className="mt-4 rounded-lg bg-sunken p-3 text-sm leading-6 text-ink-2">
          组员交付证据：{sample.values.evidence}
        </p>
      )}
      {phase === 12 && (
        <p className="mt-4 rounded-lg bg-sunken p-3 text-sm leading-6 text-ink-2">
          组长集成记录：{sample.values.integration}
        </p>
      )}
      <form
        className="mt-5 space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending || done) return;
          const values = Object.fromEntries(
            new FormData(event.currentTarget).entries(),
          ) as Record<string, string>;
          setPending(true);
          setError("");
          try {
            const result = await completeExampleStep(phase, values);
            if ("error" in result) setError(result.error ?? "保存失败");
            else onSaved(result.sample);
          } catch {
            setError("网络中断，操作尚未保存，请重试。");
          } finally {
            setPending(false);
          }
        }}
      >
        {EXAMPLE_FIELDS[phase].map((field) => (
          <label
            key={field.key}
            className="block text-sm font-medium text-ink-2"
          >
            {field.label}
            <textarea
              name={field.key}
              aria-label={field.label}
              className="ac-field mt-2 min-h-[72px] w-full resize-y"
              rows={phase <= 1 || phase === 3 ? 2 : 3}
              defaultValue={
                sample.values[field.key] ??
                (phase === 3 ? field.placeholder : "")
              }
              placeholder={field.placeholder}
              required
              minLength={field.min}
              maxLength={2000}
              disabled={done || pending}
            />
            <span className="mt-1 block text-[11px] font-normal leading-5 text-ink-3">
              至少 {field.min} 个字。
              {phase === 2
                ? "示例任务由教学模板生成，不会调用真实 AI。"
                : "可以参照输入框中的样例填写。"}
            </span>
          </label>
        ))}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        {done ? (
          <div
            role="status"
            className="rounded-lg bg-success-soft p-3 text-sm leading-6 text-success"
          >
            ✓ 已保存：{EXAMPLE_FLOW[phase][1]}。
            {phase === 2
              ? "任务草案已生成，下一步调整分工。"
              : phase === 9
                ? "任务已进入待验收。"
                : phase === 10
                  ? "任务验收通过；下一步由组长提交阶段集成。"
                  : phase === 12
                    ? "本轮集成审核通过，下一轮已解锁。"
                    : "可以继续下一步。"}
          </div>
        ) : (
          <button type="submit" className="ac-btn" disabled={pending}>
            {pending ? "保存中…" : BUTTONS[phase]}
          </button>
        )}
      </form>
      {done && phase === 6 && (
        <div className="mt-4 rounded-lg bg-sunken p-3 text-xs leading-6 text-ink-2">
          <strong>教学 AI（预设示例回复）</strong>
          <p>
            针对“{sample.values.task}
            ”，先检查姓名和联系方式是否为空；校验失败时在字段旁显示提示并保留已填内容。通过校验后展示报名成功回执。分别记录空值与完整信息两种测试结果，作为验收证据。
          </p>
          <p className="mt-2 text-ink-3">
            你的提问已记录：{sample.values.question}
          </p>
        </div>
      )}
      {done && phase === 7 && (
        <p className="mt-3 text-xs leading-5 text-ink-3">
          教学反馈：示例组长已确认报名截止时间为周五
          18:00，活动说明已核对，规则核对任务已完成。这条组长回复使用教学样例。
        </p>
      )}
      {done && phase === 13 && (
        <p className="mt-3 text-sm leading-6 text-ink-2">
          第 2 轮草案：{sample.values.improvement} → {sample.values.assignee}
          。下一轮仍需组长确认并发布。
        </p>
      )}
    </section>
  );
}
