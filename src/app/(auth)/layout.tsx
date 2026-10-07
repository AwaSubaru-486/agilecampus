export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid min-h-screen w-full max-w-6xl items-center gap-8 px-5 py-10 lg:grid-cols-2 lg:gap-20 lg:px-10">
      <aside className="space-y-7 lg:pr-8">
        <p className="text-base font-semibold tracking-tight text-signal">
          AgileCampus
        </p>
        <h2 className="max-w-lg text-3xl font-semibold leading-tight text-ink sm:text-4xl">
          让每一次协作，
          <br />
          都接得住、交得清。
        </h2>
        <p className="max-w-md text-sm leading-7 text-ink-3">
          明确下一步要做什么，把任务背景、责任和交付证据留在同一个项目里。
        </p>
        <ol className="hidden space-y-5 border-l border-stroke pl-6 text-sm text-ink-2 lg:block">
          <li>
            <strong className="block font-medium text-ink">先找到团队</strong>
            <span className="mt-1 block text-xs text-ink-3">
              创建或加入项目，确认各自的角色。
            </span>
          </li>
          <li>
            <strong className="block font-medium text-ink">
              再推进一项任务
            </strong>
            <span className="mt-1 block text-xs text-ink-3">
              读清要求，认领、协作并提交成果。
            </span>
          </li>
          <li>
            <strong className="block font-medium text-ink">
              最后完成一轮交付
            </strong>
            <span className="mt-1 block text-xs text-ink-3">
              按证据验收，把经验带到下一轮。
            </span>
          </li>
        </ol>
      </aside>
      <div className="w-full">{children}</div>
    </div>
  );
}
