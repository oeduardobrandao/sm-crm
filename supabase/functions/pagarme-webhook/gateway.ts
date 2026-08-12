// Thin port over pagarmeFetch so the handler is testable with a fake gateway,
// mirroring pagarme-checkout/gateway.ts.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import type { RemoteSubscriptionFields } from "./logic.ts";

export interface RemoteSubscription extends RemoteSubscriptionFields {
  id: string;
  metadata?: Record<string, string> | null;
}

export interface WebhookGateway {
  /** GET /subscriptions/{id} — fetch-before-trust source of truth. Throws PagarmeApiError/timeout. */
  fetchSubscription(subId: string): Promise<RemoteSubscription>;
}

export function createPagarmeWebhookGateway(): WebhookGateway {
  return {
    fetchSubscription: (subId) =>
      pagarmeFetch<RemoteSubscription>("GET", `/subscriptions/${subId}`),
  };
}
