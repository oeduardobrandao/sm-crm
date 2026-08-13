// Thin port over pagarmeFetch for the cron's remote legs (stale-attempt compensating cancels
// in leg B, and the orphan sweep's list + cancel in leg C). Keep it free of decisions.

import { pagarmeFetch } from "../_shared/pagarme.ts";

export interface RemoteSubListItem {
  id: string;
  status?: string;
  created_at?: string | null;
  metadata?: { workspace_id?: string | null } | null;
}

export interface DowngradeCronGateway {
  /** GET /subscriptions?status=&page=&size= — page/size pagination, {data, paging} envelope. */
  listSubscriptions(
    status: "active" | "future",
    page: number,
    size: number,
  ): Promise<{ data: RemoteSubListItem[]; paging?: { total_pages?: number } }>;
  /** DELETE /subscriptions/{id}. */
  cancelSubscription(subId: string): Promise<unknown>;
}

export function createDowngradeCronGateway(): DowngradeCronGateway {
  return {
    listSubscriptions: (status, page, size) =>
      pagarmeFetch("GET", `/subscriptions?status=${status}&page=${page}&size=${size}`),
    cancelSubscription: (subId) => pagarmeFetch("DELETE", `/subscriptions/${subId}`),
  };
}
