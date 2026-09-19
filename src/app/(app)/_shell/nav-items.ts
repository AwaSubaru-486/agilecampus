// 一级导航。五项，桌面横向排在顶部工作带里。
//
// 术语与顺序由 docs/design/product-language.md §4 冻结，改这里之前先改那份文档。
//
// 与旧版的差别不只是换了名字：旧版一级导航是「项目空间 / 风险瞭望 /
// 团队成员 / 连接与设置」——以「系统有哪些东西」组织；
// 这里是「今日 / 项目 / 协作 / 资料库 / 设置」——以「我每天要做什么」组织。

export type NavItem = {
  href: string;
  label: string;
  /** 无障碍名。图标按钮必须有名可读 */
  hint: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/today", label: "今日", hint: "跨项目的行动队列" },
  { href: "/projects", label: "项目", hint: "项目脉搏与最近访问" },
  { href: "/collaboration", label: "协作", hint: "求助邀请与 AI 待确认动作" },
  { href: "/library", label: "资料库", hint: "跨项目的成果与文档" },
  { href: "/settings", label: "设置", hint: "账户、连接、令牌与通知" },
] as const;

/** 当前路径命中哪一项。用前缀匹配，使子路由也能点亮父项。 */
export function activeNavHref(pathname: string): string | null {
  // 长的优先，避免 /settings/tokens 同时命中 /settings 与自身
  const sorted = [...NAV_ITEMS].sort((a, b) => b.href.length - a.href.length);
  for (const item of sorted) {
    if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return item.href;
  }
  return null;
}
