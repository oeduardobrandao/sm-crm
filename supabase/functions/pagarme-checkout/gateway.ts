// Thin typed port over the Pagar.me core/v5 API for the checkout flow. All I/O goes through
// _shared/pagarme.ts (Basic auth, 5s timeout, PagarmeApiError). The interface exists so the
// handler can be tested with a fake — keep it free of decisions.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import { PagarmeCheckoutRequest } from "./logic.ts";

export interface PagarmeCustomerInput {
  name: string;
  email: string;
  document: string;
  document_type: "cpf" | "cnpj";
  type: "individual" | "company";
  phones: { mobile_phone: { country_code: "55"; area_code: string; number: string } };
}

export interface PagarmeSubscriptionInput {
  plan_id: string;
  customer_id: string;
  card_id: string;
  installments: 12;
  start_at?: string;
  metadata: { workspace_id: string; plan_id: string };
}

export interface PagarmeSubscriptionResponse {
  id: string;
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  current_cycle?: { end_at?: string | null } | null;
  /** The plan object's items as billed on THIS subscription. `items[0].pricing_scheme.price`
   * is the gateway-observed total (Fase 8 truthful-mirror rule): the plans row is only a
   * mirror, so this is what actually got charged and must win over the configured value. */
  items?: Array<{ pricing_scheme?: { price?: number | null } | null } | null> | null;
}

export interface PagarmeGateway {
  /** POST /customers. Email is the natural key: a second create with the same email UPDATES
   * and returns the same customer (spike criterion 6), so this is find-or-create. */
  upsertCustomer(input: PagarmeCustomerInput): Promise<{ id: string }>;
  /** POST /customers/{id}/cards with billing_address. The address MUST ride on the attach:
   * the token's own billing_address is ignored by the gateway, and passing card_token
   * straight to the subscription deduplicates to a saved card WITHOUT an address, which the
   * charge then rejects (spike finding). Always use the returned card id. */
  attachCard(
    customerId: string,
    token: string,
    address: PagarmeCheckoutRequest["billingAddress"],
  ): Promise<{ id: string }>;
  /** POST /subscriptions with an Idempotency-Key (honored by the gateway; spike criterion 5). */
  createSubscription(
    input: PagarmeSubscriptionInput,
    idempotencyKey: string,
  ): Promise<PagarmeSubscriptionResponse>;
  /** DELETE /subscriptions/{id} — immediate cancel; used to compensate a failed first charge. */
  cancelSubscription(id: string): Promise<void>;
}

export function createPagarmeGateway(): PagarmeGateway {
  return {
    upsertCustomer: (input) => pagarmeFetch<{ id: string }>("POST", "/customers", input),
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
    createSubscription: (input, idempotencyKey) =>
      pagarmeFetch<PagarmeSubscriptionResponse>(
        "POST",
        "/subscriptions",
        { ...input, payment_method: "credit_card" },
        { idempotencyKey },
      ),
    cancelSubscription: async (id) => {
      await pagarmeFetch("DELETE", `/subscriptions/${id}`);
    },
  };
}
