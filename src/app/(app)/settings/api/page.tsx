import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getModelConfigStatus } from "@/lib/model-config";
import { ApiConfigForm } from "./api-config-form";

export default async function ApiConfigPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const config = await getModelConfigStatus(session.user.id);
  return <div className="mx-auto max-w-2xl space-y-8 py-8">
    <header className="ac-page-header"><h1>API 配置</h1><p>先连接模型服务，再生成任务草案和使用 AI 会话。</p></header>
    <ApiConfigForm config={config} />
  </div>;
}
