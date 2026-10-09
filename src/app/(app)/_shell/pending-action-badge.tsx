import { countMyPendingActions } from "@/lib/shell";

export async function PendingActionBadge({ userId }: { userId: string }) {
  const count = await countMyPendingActions(userId);
  return count > 0 ? <span aria-label={`${count} 项待处理`} className="ac-nav-count">{count > 9 ? "9+" : count}</span> : null;
}
