// supabase/functions/metrics-spike/index.ts
// TEMPORÁRIA — spike da spec 2026-08-31-report-app-parity. Deletar após a matriz.
// Auth: header x-spike-secret contra env SPIKE_SECRET (mesmo padrão dos crons).
import { createClient } from "npm:@supabase/supabase-js@2";
import { decryptText } from "../_shared/crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPIKE_SECRET = Deno.env.get("SPIKE_SECRET") ??
  (() => { throw new Error("SPIKE_SECRET is required"); })();
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY") ??
  (() => { throw new Error("TOKEN_ENCRYPTION_KEY is required"); })();

const ACCOUNT_ID = "b7a4333d-df8e-48f7-b3d8-94440691ea71"; // Healing Hands

const DAY = 86400;

async function decryptIgToken(encrypted: string): Promise<string> {
  // Mesma dupla de chaves de report-docs/snapshot-source.ts (HKDF + legado).
  try {
    return await decryptText(encrypted, TOKEN_ENCRYPTION_KEY, "instagram-access-token");
  } catch {
    const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(TOKEN_ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(buf);
  }
}

async function graph(token: string, qs: Record<string, string>) {
  const params = new URLSearchParams({ ...qs, access_token: token });
  const url = `https://graph.instagram.com/me/insights?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.headers.get("x-spike-secret") !== SPIKE_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: account } = await db.from("instagram_accounts")
    .select("encrypted_access_token").eq("id", ACCOUNT_ID).single();
  const token = await decryptIgToken(account!.encrypted_access_token);

  // Janela do mês de agosto/2026, half-open em unix seconds.
  const aug1 = Math.floor(Date.parse("2026-08-01T00:00:00Z") / 1000);
  const sep1 = Math.floor(Date.parse("2026-09-01T00:00:00Z") / 1000);
  const aug31 = sep1 - DAY;

  const METRICS = [
    "reach", "views", "saves", "accounts_engaged", "profile_views",
    "website_clicks", "follows_and_unfollows",
  ];

  const out: Record<string, unknown> = {};
  for (const m of METRICS) {
    // a) total_value, request único de 31 dias (range máximo? aceita?)
    out[`${m}_total_31d`] = await graph(token, {
      metric: m, metric_type: "total_value", period: "day",
      since: String(aug1), until: String(sep1),
    });
    // b) caminho de produção atual: chunks 30+1 (não-aditividade dos únicos)
    out[`${m}_total_chunk30`] = await graph(token, {
      metric: m, metric_type: "total_value", period: "day",
      since: String(aug1), until: String(aug1 + 30 * DAY),
    });
    out[`${m}_total_chunk1`] = await graph(token, {
      metric: m, metric_type: "total_value", period: "day",
      since: String(aug1 + 30 * DAY), until: String(sep1),
    });
    // c) série diária (existe values[] por dia para esta métrica?)
    out[`${m}_daily`] = await graph(token, {
      metric: m, period: "day", since: String(aug31 - 3 * DAY), until: String(sep1),
    });
  }
  // d) breakdown de follows (nome: follow_type? follower_type?)
  out["follows_breakdown_follow_type"] = await graph(token, {
    metric: "follows_and_unfollows", metric_type: "total_value", period: "day",
    breakdown: "follow_type", since: String(aug1), until: String(sep1),
  });
  out["follows_breakdown_follower_type"] = await graph(token, {
    metric: "follows_and_unfollows", metric_type: "total_value", period: "day",
    breakdown: "follower_type", since: String(aug1), until: String(sep1),
  });
  // e) follower_count diário (retenção ~30d)
  out["follower_count_daily"] = await graph(token, {
    metric: "follower_count", period: "day",
    since: String(sep1 - 30 * DAY), until: String(sep1),
  });
  // f) fora da retenção (vazio vs erro — semântica de "indisponível")
  out["reach_out_of_retention"] = await graph(token, {
    metric: "reach", metric_type: "total_value", period: "day",
    since: String(aug1 - 200 * DAY), until: String(aug1 - 170 * DAY),
  });
  // g) D-1 para medir latência de finalização (chamar de novo amanhã e comparar)
  out["finalization_probe_d1"] = await graph(token, {
    metric: "views", metric_type: "total_value", period: "day",
    since: String(sep1 - DAY), until: String(sep1),
  });

  return new Response(JSON.stringify(out, null, 2), {
    headers: { "content-type": "application/json" },
  });
});
