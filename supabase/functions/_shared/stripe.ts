import Stripe from "npm:stripe@17";

const STRIPE_SECRET_KEY =
  Deno.env.get("STRIPE_SECRET_KEY") ??
  (() => {
    throw new Error("STRIPE_SECRET_KEY environment variable is required");
  })();

// Use the fetch-based HTTP client (Deno has no Node http).
export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

// Deno's Web Crypto is async — required by constructEventAsync for webhook verification.
export const cryptoProvider = Stripe.createSubtleCryptoProvider();
