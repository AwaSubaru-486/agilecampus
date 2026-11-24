import type { EvidenceType } from "@/lib/handoff";

const EVIDENCE_FIELDS: Record<EvidenceType, { label: string; hint: string; control: "input" | "textarea" }> = {
  link: { label: "链接", hint: "粘贴 http:// 或 https:// 开头的地址", control: "input" },
  file: { label: "交付文件", hint: "填写文件链接、仓库路径或文件位置", control: "textarea" },
  text: { label: "文字说明", hint: "填写本项交付说明", control: "textarea" },
  test: { label: "测试结果", hint: "填写执行的测试及结果", control: "textarea" },
  demo: { label: "演示材料", hint: "填写演示链接、录屏位置或截图说明", control: "textarea" },
};

export function missingRequiredEvidenceTypes(
  required: EvidenceType[] | null | undefined,
  existing: string[],
) {
  const present = new Set(existing);
  return [...new Set(required ?? [])].filter((type) => !present.has(type));
}

export function RequiredEvidenceFields({ types }: { types: EvidenceType[] }) {
  if (types.length === 0) return null;

  return (
    <fieldset className="space-y-2 border-t border-line pt-2">
      <legend className="text-xs font-medium text-ink">必需交付材料</legend>
      <p className="text-xs text-ink-3">补齐以下材料后，任务才能提交验收。</p>
      {types.map((type) => {
        const field = EVIDENCE_FIELDS[type];
        return (
          <label key={type} className="block space-y-1 text-xs text-ink-soft">
            <span>{field.label} <span className="text-risk">*</span></span>
            {field.control === "input" ? (
              <input
                name={`evidence_${type}`}
                type="url"
                required
                maxLength={8_000}
                placeholder={field.hint}
                className="ac-field text-sm"
              />
            ) : (
              <textarea
                name={`evidence_${type}`}
                required
                maxLength={8_000}
                rows={2}
                placeholder={field.hint}
                className="ac-field text-sm"
              />
            )}
          </label>
        );
      })}
    </fieldset>
  );
}
