// Event handler for stream-webhook. Server-to-server delivery from Cloudflare Stream — no CORS,
// no JWT (config.toml: verify_jwt = false). The `Webhook-Signature` header IS the auth: the raw
// body must be read and verified before it's parsed. Every non-signature-failure path acks with
// 200 (unknown uid, already-settled row, unrecognized state) so Cloudflare never redelivers a
// message this handler already understood; only a genuine internal failure returns 5xx.

import { createJsonResponder, internalServerError } from "../_shared/http.ts";
import type { StreamVideoInfo } from "../_shared/stream.ts";

// deno-lint-ignore no-explicit-any
type DbClient = any;

export interface StreamWebhookDeps {
  createDb: () => DbClient;
  verifySignature: (body: string, header: string | null) => Promise<boolean>;
  /** Authoritative playback details for a tutorial video (kb_videos) once Stream says ready. */
  getStreamVideo: (uid: string) => Promise<StreamVideoInfo>;
}

interface StreamWebhookPayload {
  uid?: string;
  status?: { state?: string };
}

/** Patch for a pending kb_videos row, or null to leave it pending (refresh-kb-video in the Admin
 * resolves it later). Playback fields come from the Stream API, not the webhook body, so the
 * handler never depends on the delivery's shape; `ready` is never written without an HLS url. */
async function kbVideoPatch(
  deps: StreamWebhookDeps,
  uid: string,
  mapped: "ready" | "error",
): Promise<Record<string, unknown> | null> {
  if (mapped === "error") return { stream_status: "error", stream_upload_expires_at: null };
  try {
    const info = await deps.getStreamVideo(uid);
    if (info.state !== "ready" || !info.hls) {
      console.warn("[stream-webhook:kb-settle] not ready yet", uid, info.state);
      return null;
    }
    return {
      stream_status: "ready",
      duration_seconds: info.duration,
      hls_url: info.hls,
      thumbnail_url: info.thumbnail,
      stream_upload_expires_at: null,
    };
  } catch (err) {
    console.error("[stream-webhook:kb-settle] stream lookup failed", uid, err);
    return null;
  }
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

      // Tutoriais da Central de Ajuda. Uids do Stream são únicos na conta, então no máximo uma
      // das duas tabelas casa. Mesma guarda monotônica (só sai de pending) que files.
      const { data: kbRows, error: kbErr } = await svc
        .from("kb_videos")
        .select("id")
        .eq("stream_uid", uid)
        .eq("stream_status", "pending")
        .limit(1);
      if (kbErr) return internalServerError(json, "stream-webhook:kb-settle", kbErr);
      const kbRow = ((kbRows ?? []) as Array<{ id: number }>)[0];
      if (kbRow) {
        const patch = await kbVideoPatch(deps, uid, mapped);
        if (patch) {
          const { error: updErr } = await svc
            .from("kb_videos")
            .update(patch)
            .eq("id", kbRow.id)
            .eq("stream_uid", uid)
            .eq("stream_status", "pending");
          if (updErr) return internalServerError(json, "stream-webhook:kb-settle", updErr);
        }
      }
    } catch (err) {
      return internalServerError(json, "stream-webhook:settle", err);
    }

    return json({ received: true }, 200);
  };
}
