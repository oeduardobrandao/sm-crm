/**
 * Archive/deactivate the Stripe products + prices created by create-stripe-prices.ts.
 *
 * Stripe prices can't be deleted (only deactivated), and a product that has prices
 * can only be archived (active=false). So this deactivates each matching price and
 * archives each matching product. It finds them by the `mesaas_key` metadata the
 * create script stamped, so it cleans up ALL of them — including duplicates from
 * multiple runs. Run it with the SAME key/mode you created them in (test key →
 * cleans test objects; live key → cleans live objects).
 *
 * Idempotent: re-running finds nothing once everything is archived.
 *
 * Usage (Deno):
 *   STRIPE_SECRET_KEY=sk_test_xxx deno run -A --node-modules-dir=auto scripts/cleanup-stripe-prices.ts --dry-run
 *   STRIPE_SECRET_KEY=sk_test_xxx deno run -A --node-modules-dir=auto scripts/cleanup-stripe-prices.ts
 * After running, if deno.lock changed: git checkout deno.lock
 */
import Stripe from "npm:stripe@17";

const DRY = Deno.args.includes("--dry-run");
const key = Deno.env.get("STRIPE_SECRET_KEY");
if (!key) {
  console.error("ERROR: STRIPE_SECRET_KEY env var is required.");
  Deno.exit(1);
}
const stripe = new Stripe(key);
console.log(`\nStripe mode: ${key.startsWith("sk_live_") ? "⚠️  LIVE" : "TEST"}${DRY ? "  (dry-run — no changes)" : ""}\n`);

const KEYS = new Set(["starter", "agency", "scale", "seat"]);

const products = await stripe.products.list({ active: true, limit: 100 });
const targets = products.data.filter((p) => KEYS.has(p.metadata?.mesaas_key ?? ""));
if (targets.length === 0) {
  console.log("No matching active products found — already cleaned (or created with a different key/mode).\n");
  Deno.exit(0);
}
console.log(`Found ${targets.length} matching product(s) to archive.\n`);

for (const p of targets) {
  console.log(`Product ${(p.metadata?.mesaas_key ?? "?").padEnd(8)} ${p.id}  (${p.name})`);
  const prices = await stripe.prices.list({ product: p.id, active: true, limit: 100 });
  for (const pr of prices.data) {
    if (DRY) {
      console.log(`  price   - would deactivate ${pr.id}`);
      continue;
    }
    await stripe.prices.update(pr.id, { active: false });
    console.log(`  price   - deactivated ${pr.id}`);
  }
  if (DRY) {
    console.log(`  product - would archive ${p.id}`);
    continue;
  }
  await stripe.products.update(p.id, { active: false });
  console.log(`  product - archived ${p.id}`);
}
console.log(`\nDone.${DRY ? " (dry-run — nothing changed)" : ""}\n`);
