// Thin port over pagarmeFetch. No decisions here; the handler owns control flow.
import { pagarmeFetch } from "../_shared/pagarme.ts";

export interface PagarmeSubscriptionGateway {
  /**
   * DELETE /subscriptions/{id} — immediate cancellation (spike: no cancel-at-period-end
   * exists). The 200 body is the full canceled subscription; current_cycle.end_at is the
   * paid-through boundary the handler may need when the local row never stored one.
   */
  cancelSubscription(
    subId: string,
  ): Promise<{ current_cycle?: { end_at?: string | null } | null } | null>;
  /** POST /customers/{id}/cards — same attach shape as pagarme-checkout's gateway. */
  attachCard(
    customerId: string,
    token: string,
    address: { cep: string; line1: string; city: string; state: string },
  ): Promise<{ id: string }>;
  /** PATCH /subscriptions/{id}/card with the freshly attached card_id. */
  updateSubscriptionCard(subId: string, cardId: string): Promise<unknown>;
}

export function createPagarmeSubscriptionGateway(): PagarmeSubscriptionGateway {
  return {
    cancelSubscription: (subId) => pagarmeFetch("DELETE", `/subscriptions/${subId}`),
    attachCard: (customerId, token, address) =>
      pagarmeFetch<{ id: string }>("POST", `/customers/${customerId}/cards`, {
        token,
        billing_address: {
          line_1: address.line1,
          zip_code: address.cep,
          city: address.city,
          state: address.state,
          country: "BR",
        },
      }),
    updateSubscriptionCard: (subId, cardId) =>
      pagarmeFetch("PATCH", `/subscriptions/${subId}/card`, { card_id: cardId }),
  };
}
