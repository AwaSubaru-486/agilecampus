// 当日日期（YYYY-MM-DD），服务端本地时区。
//
// 全仓唯一取法。此前有两套：页面侧用 toLocaleDateString("sv-SE")（本地时区），
// lib 侧用 toISOString().slice(0, 10)（UTC）——在 UTC+8 每天 06:00 之前两者相差一天。
// 彼时只是「两处日期不一致」，健康度一上线就是「项目页说 3 个逾期、健康卡说 2 个」，
// 演示现场必被问到，故统一于此。
//
// 取本地时区而非 UTC：对使用者而言「今天」是他所在的今天。
// sv-SE 的日期格式恰为 YYYY-MM-DD，直接取用，无需手工补零。
export function today(): string {
  return new Date().toLocaleDateString("sv-SE");
}
