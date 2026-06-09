import { assert } from "./assert.ts";

const CONFIG_PATH = new URL("../../config.toml", import.meta.url).pathname;

function parseVerifyJwtFunctions(toml: string): Set<string> {
  const result = new Set<string>();
  const lines = toml.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\[functions\.(.+)\]$/);
    if (match) {
      const nextLine = lines[i + 1]?.trim();
      if (nextLine === "verify_jwt = false") {
        result.add(match[1]);
      }
    }
  }
  return result;
}

const REQUIRED_FUNCTIONS = [
  // Cron (x-cron-secret)
  "instagram-sync-cron",
  "instagram-refresh-cron",
  "instagram-publish-cron",
  "notification-deadline-cron",
  "notification-cleanup-cron",
  "express-post-cleanup-cron",
  "post-media-backfill-thumbnails",
  "post-media-cleanup-cron",
  "analytics-report-cron",
  "invite-expire-cron",
  // Token/internal auth
  "instagram-integration",
  "hub-bootstrap",
  "hub-posts",
  "hub-approve",
  "hub-brand",
  "hub-pages",
  "hub-briefing",
  "hub-ideias",
  "hub-instagram-feed",
  "hub-dashboard",
  "post-media-upload-url",
  "post-media-finalize",
  "post-media-manage",
  "platform-admin",
  "workspace-limits",
  "file-manage",
  "file-upload-finalize",
  "file-upload-url",
  "file-zip",
  "instagram-analytics",
  "instagram-report-generator",
  "invite-user",
  "manage-workspace-user",
  "portal-approve",
  "portal-data",
  "sign-r2-urls",
  // Billing (manual auth: user-JWT or Stripe signature)
  "billing-checkout",
  "billing-portal",
  "stripe-webhook",
];

Deno.test("config.toml: all non-JWT functions have verify_jwt = false", async () => {
  const toml = await Deno.readTextFile(CONFIG_PATH);
  const configured = parseVerifyJwtFunctions(toml);
  const missing: string[] = [];
  for (const fn of REQUIRED_FUNCTIONS) {
    if (!configured.has(fn)) missing.push(fn);
  }
  assert(missing.length === 0, `Functions missing verify_jwt = false: ${missing.join(", ")}`);
});
