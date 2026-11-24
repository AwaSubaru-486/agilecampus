import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listApiTokens } from "@/lib/api-token";
import { TokenManager, type TokenRow } from "./token-manager";

function fmt(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function TokensPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const rows = await listApiTokens(session.user.id);
  const tokens: TokenRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    createdAtLabel: fmt(t.createdAt)!,
    lastUsedLabel: fmt(t.lastUsedAt),
    revoked: t.revokedAt !== null,
  }));

  return (
    <main className="mx-auto max-w-2xl space-y-8 py-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-semibold text-ink">个人访问令牌</h1>
        <p className="text-sm text-ink-2">
          令牌让 Claude Code 等外部程序以你的身份写入——添加任务、填写完成情况、登记资源占用。
          权限等同于你本人，越权操作会被拒绝。泄露即撤销。
        </p>
      </header>

      <TokenManager tokens={tokens} />

      <section id="vscode-connection" className="ac-card scroll-mt-6 space-y-3 p-5">
        <h2 className="font-display text-base font-semibold text-ink">连接 VS Code 插件</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          <li>安装 AgileCampus 插件。在本项目源码的 vscode-extension 目录中按 README 安装，或使用团队提供的 VSIX 安装包。</li>
          <li>在上方创建个人访问令牌，再打开 VS Code 命令面板，运行“AgileCampus: 连接项目”。</li>
          <li>填写当前网站地址和个人令牌，选择项目与具体任务。</li>
          <li>使用“发布检查点摘要”和“交接给成员”共享检查点。并行工作可运行“创建并行尝试 worktree”，结果在“查看本地 Agent 尝试”中查看。</li>
        </ol>
      </section>

      <section className="ac-card space-y-3 p-5">
        <h2 className="font-display text-base font-semibold text-ink">如何在 Claude Code 中使用</h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
          <li>在上方生成令牌，复制明文（只显一次）。</li>
          <li>
            把令牌与本站地址配置给 Claude Code（作为 <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">AGILECAMPUS_TOKEN</code> 与
            <code className="ml-1 rounded bg-sunken px-1 py-0.5 font-mono text-xs">AGILECAMPUS_URL</code>）。
          </li>
          <li>
            即可让 Claude Code 携令牌调用 <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">/api/agent/*</code> 端点，替你写入。详见项目文档
            <code className="ml-1 rounded bg-sunken px-1 py-0.5 font-mono text-xs">docs/agent-api.md</code>。
          </li>
        </ol>
      </section>
    </main>
  );
}
