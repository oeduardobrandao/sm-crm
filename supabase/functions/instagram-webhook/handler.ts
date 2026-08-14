// supabase/functions/instagram-webhook/handler.ts
// Receiver de webhooks de comentário da Meta (Instagram Login). Endpoint
// PÚBLICO (config.toml: verify_jwt = false); a autenticação é a assinatura
// X-Hub-Signature-256 (HMAC-SHA256 do body CRU com META_APP_SECRET) e, no GET
// de verificação, o hub.verify_token. SEM CORS de propósito: tráfego
// servidor-a-servidor, como stripe-webhook/pagarme-webhook. Nunca ecoar o
// payload: toda resposta tem corpo vazio (exceto o hub.challenge do handshake,
// que é o protocolo da Meta).
//
// Durable-ack (padrão tiktok-webhook):
//   1. valida assinatura sincronamente (falha -> 401, nada persiste);
//   2. normaliza a entrega em 1 linha POR COMENTÁRIO e insere TUDO em um
//      lote, awaited, ANTES do 200 (falha -> 500, a Meta reentrega);
//   3. responde 200 vazio;
//   4. só então processa via waitUntil (Task 9 injeta o processador real).
import { timingSafeEqual } from "../_shared/crypto.ts";
import { parseWebhookDelivery } from "./parse.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
};

export interface EventRow {
  id: string;
  delivery_id: string;
  ig_user_id: string;
  comment_id: string;
  raw: unknown;
}

export interface InstagramWebhookDeps {
  createServiceDb: () => DbClient;
  metaAppSecret: string;
  verifyToken: string;
  waitUntil: (p: Promise<void>) => void;
  processDelivery?: (svc: DbClient, rows: EventRow[]) => Promise<void>;
  randomUUID?: () => string;
}

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function createInstagramWebhookHandler(deps: InstagramWebhookDeps) {
  const randomUUID = deps.randomUUID ?? (() => crypto.randomUUID());
  const processDelivery = deps.processDelivery ??
    ((_svc: DbClient, rows: EventRow[]) => {
      console.log(`[instagram-webhook] processDelivery ausente; ${rows.length} evento(s) ficam para o cron`);
      return Promise.resolve();
    });

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    // Handshake de verificação da Meta (configuração do app no painel).
    if (req.method === "GET") {
      const mode = url.searchParams.get("hub.mode") ?? "";
      const token = url.searchParams.get("hub.verify_token") ?? "";
      const challenge = url.searchParams.get("hub.challenge") ?? "";
      if (mode === "subscribe" && timingSafeEqual(token, deps.verifyToken)) {
        return new Response(challenge, { status: 200 });
      }
      return new Response(null, { status: 403 });
    }

    if (req.method !== "POST") {
      return new Response(null, { status: 405 });
    }

    // Body CRU antes de qualquer parse: a assinatura é sobre os bytes exatos.
    const bodyText = await req.text();
    const header = req.headers.get("X-Hub-Signature-256") ?? "";
    const expected = `sha256=${await hmacSha256Hex(deps.metaAppSecret, bodyText)}`;
    if (!header || !timingSafeEqual(header, expected)) {
      console.error("[instagram-webhook] assinatura inválida; descartando");
      return new Response(null, { status: 401 });
    }

    let body: unknown;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return new Response(null, { status: 200 });
    }

    const events = parseWebhookDelivery(body);
    if (events.length === 0) {
      return new Response(null, { status: 200 });
    }

    const svc = deps.createServiceDb();
    const deliveryId = randomUUID();
    const rows: EventRow[] = events.map((e) => ({
      id: randomUUID(),
      delivery_id: deliveryId,
      ig_user_id: e.igUserId,
      comment_id: e.commentId,
      raw: e.raw,
    }));

    const { error } = await svc.from("instagram_webhook_events").insert(rows);
    if (error) {
      console.error("[instagram-webhook] falha ao persistir eventos; 500 para a Meta reentregar:", error.message);
      return new Response(null, { status: 500 });
    }

    deps.waitUntil(processDelivery(svc, rows));
    return new Response(null, { status: 200 });
  };
}
