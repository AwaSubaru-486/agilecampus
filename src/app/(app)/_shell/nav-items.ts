// 一级导航。三项，桌面横向排在顶部工作带里。
//
// 术语与顺序由 docs/design/product-language.md §4 冻结，改这里之前先改那份文档。
//
// 与旧版的差别不只是换了名字：旧版一级导航是「项目空间 / 风险瞭望 /
// 团队成员 / 连接与设置」——以「系统有哪些东西」组织；
// 这里只保留「今日 / 项目 / 协作中心」——以「我现在要做什么」组织。
// 资料库和设置仍保留原路由，但降级到账户菜单，避免把低频配置混入主路径。

export type NavItem = {
  href: string;
  label: string;
  /** 无障碍名。图标按钮必须有名可读 */
  hint: string;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/today", label: "今日", hint: "跨项目的行动队列" },
  { href: "/projects", label: "项目", hint: "项目脉搏与最近访问" },
  { href: "/collaboration", label: "协作中心", hint: "求助、AI 确认与团队状态" },
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
