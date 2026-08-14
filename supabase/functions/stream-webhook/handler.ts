// Event handler for stream-webhook. Server-to-server delivery from Cloudflare Stream — no CORS,
// no JWT (config.toml: verify_jwt = false). The `Webhook-Signature` header IS the auth: the raw
// body must be read and verified before it's parsed. Every non-signature-failure path acks with
// 200 (unknown uid, already-settled row, unrecognized state) so Cloudflare never redelivers a
// message this handler already understood; only a genuine internal failure returns 5xx.

import { createJsonResponder, internalServerError } from "../_shared/http.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

export interface StreamWebhookDeps {
  createDb: () => DbClient;
  verifySignature: (body: string, header: string | null) => Promise<boolean>;
}

interface StreamWebhookPayload {
  uid?: string;
  status?: { state?: string };
}

export function createStreamWebhookHandler(deps: StreamWebhookDeps) {
  const json = createJsonResponder({});

  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // Raw text FIRST — the signature covers the exact bytes on the wire, not a re-serialized copy.
    const body = await req.text();
    const verified = await deps.verifySignature(body, req.headers.get("Webhook-Signature"));
    if (!verified) return json({ error: "invalid signature" }, 401);

    let payload: StreamWebhookPayload;
    try {
      payload = JSON.parse(body);
    } catch {
      // Malformed body from an otherwise-authenticated sender: nothing actionable, ack so it's
      // never redelivered.
      return json({ received: true }, 200);
    }

    const uid = payload?.uid;
    if (!uid) return json({ received: true }, 200);

    const state = payload?.status?.state;
    const mapped = state === "ready" ? "ready" : state === "error" ? "error" : null;
    if (!mapped) return json({ received: true }, 200);

    try {
      const svc = deps.createDb();
      // Monotonic settle: guarded on stream_status = 'pending' so a late/duplicate "error"
      // delivery can never downgrade a row that already settled to "ready" (or vice versa).
      // Unknown uid or an already-settled row both match zero rows here — still a 200 ack.
      const { error } = await svc
        .from("files")
        .update({ stream_status: mapped })
        .eq("stream_uid", uid)
        .eq("stream_status", "pending");
      if (error) return internalServerError(json, "stream-webhook:settle", error);
    } catch (err) {
      return internalServerError(json, "stream-webhook:settle", err);
    }

    return json({ received: true }, 200);
  };
}
