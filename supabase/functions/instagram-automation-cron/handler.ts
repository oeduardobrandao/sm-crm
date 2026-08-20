// supabase/functions/instagram-automation-cron/handler.ts
// Cron de retry/manutenção da automação de comentário -> DM (roda a cada 5
// min via pg_cron, migration 20260815000005). Público na Meta: acesso é só
// x-cron-secret, sem CORS (tráfego servidor-a-servidor, padrão de todo cron
// da casa).
//
// Sete fases, nesta ordem, cada uma no seu try/catch: uma fase quebrada NUNCA
// impede as seguintes de rodar. Falhas são acumuladas e reportadas via
// `reportCronFailure` (_shared/triage.ts) no final, se houver alguma; a
// resposta HTTP é sempre 200 com { ok: true, failed: N } -- nunca detalhe
// interno para fora.
//
//   1. Auth (x-cron-secret + timingSafeEqual) -- ANTES de qualquer chamada de
//      banco; `createServiceDb()` só é invocado depois que o segredo confere.
//   2. `fail_ineligible_automation_sends()` -- encerra sends que nunca mais
//      serão elegíveis (janela de 7 dias vencida ou conta inapta).
//   3. Sweep de eventos órfãos: `instagram_webhook_events` nunca normalizados
//      (processed_at NULL) há mais de 10 min -> reprocessa via
//      `processDelivery` (Task 9), idempotente por natureza (claims caem em
//      conflito).
//   4. Sweep de convergência: `sweep_pending_instagram_automation_links()`
//      liga automações com alvo em post interno que já publicou.
//   5. Retries: `claim_retryable_automation_sends(25)` -> `executeSend`
//      (Task 9, a MESMA máquina de estados do webhook) para cada linha
//      claimada.
//   6. Re-check diário de assinaturas: contas com automação ativa cuja
//      `comments_subscribed_at` passou de 24h -> `fetchSubscribedFields`
//      (Task 6); sem "comments" -> limpa a coluna + notifica
//      (`subscription_lost`); com -> renova o carimbo.
//   7. Purge: eventos processados há mais de 30 dias.
import { createProcessDelivery, executeSend } from "../instagram-webhook/process.ts";
import type { ClaimedSend } from "../instagram-webhook/process.ts";
import type { EventRow } from "../instagram-webhook/handler.ts";
import { fetchSubscribedFields } from "../_shared/instagram-messaging.ts";
import type { IgMessagingDeps } from "../_shared/instagram-messaging.ts";
import { decryptToken as defaultDecryptToken } from "../_shared/instagram-publish-utils.ts";
import { notifyAutomationFailure } from "../_shared/automation-notify.ts";
import { reportCronFailure } from "../_shared/triage.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const CRON_NAME = "instagram-automation-cron";
const SWEEP_LIMIT = 50;
const SWEEP_STALE_MS = 10 * 60 * 1000;
const RETRY_LIMIT = 25;
const SUBSCRIPTION_STALE_MS = 24 * 60 * 60 * 1000;
const PURGE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface InstagramAutomationCronDeps {
  cronSecret: string;
  createServiceDb: () => SupabaseClient;
  timingSafeEqual: (a: string, b: string) => boolean;
  fetchFn?: typeof fetch;
  decryptToken?: (t: string) => Promise<string>;
  now?: () => Date;
}

interface CronErrorEntry {
  accountId?: string;
  error: string;
}

interface AutomationRefRow {
  client_id: number;
  conta_id: string;
}

interface StaleAccountRow {
  id: string;
  client_id: number;
  encrypted_access_token: string;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function createInstagramAutomationCronHandler(deps: InstagramAutomationCronDeps) {
  const decryptTokenFn = deps.decryptToken ?? defaultDecryptToken;
  const now = deps.now ?? (() => new Date());
  const msgDeps: IgMessagingDeps = { fetchFn: deps.fetchFn };
  // `svc` aqui é `any` (contrato de createProcessDelivery, Task 9): o cast pra
  // baixo pro seu DbClient estrito é interno ao próprio módulo.
  const processDelivery = createProcessDelivery({
    fetchFn: deps.fetchFn,
    decryptToken: decryptTokenFn,
    now,
  });

  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const svc = deps.createServiceDb();
    const nowDate = now();
    let failed = 0;
    const errors: CronErrorEntry[] = [];

    // 2. Sends que nunca mais serão elegíveis (janela vencida / conta inapta).
    try {
      const { data, error } = await svc.rpc("fail_ineligible_automation_sends");
      if (error) throw new Error(errMessage(error));
      console.log(`[${CRON_NAME}] fail_ineligible_automation_sends: ${data ?? 0} encerrado(s)`);
    } catch (err) {
      console.error(`[${CRON_NAME}] fail_ineligible_automation_sends falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `fail_ineligible_automation_sends: ${errMessage(err)}` });
    }

    // 3. Sweep de eventos órfãos: nunca normalizados, mais de 10 min parados.
    // Reprocessar é seguro (idempotente): claim_automation_send cai em
    // conflito de comment_id UNIQUE se já tiver rodado antes.
    try {
      const staleCutoff = new Date(nowDate.getTime() - SWEEP_STALE_MS).toISOString();
      const { data, error } = await svc
        .from("instagram_webhook_events")
        .select("id, delivery_id, ig_user_id, comment_id, raw")
        .is("processed_at", null)
        .lt("received_at", staleCutoff)
        .limit(SWEEP_LIMIT);
      if (error) throw new Error(errMessage(error));
      const rows = (data ?? []) as EventRow[];
      if (rows.length > 0) {
        console.log(`[${CRON_NAME}] sweep: ${rows.length} evento(s) órfão(s)`);
        // deno-lint-ignore no-explicit-any
        await processDelivery(svc as any, rows);
      }
    } catch (err) {
      console.error(`[${CRON_NAME}] sweep falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `sweep: ${errMessage(err)}` });
    }

    // 4. Sweep de convergência dos vínculos pendentes. O resolver das
    // automações lê `workflow_posts` SEM lock (evita deadlock com a
    // publicação), então sobra uma janela MVCC: o post publica e uma automação
    // pendente commitada em paralelo não enxerga o media ID (nem o trigger
    // enxerga a automação). A RPC religa o que ficou para trás -- convergência
    // em no máximo 5 min, o intervalo do cron. As guardas de deriva
    // (cliente/plataforma/tipo) são da própria RPC; aqui só chamamos e logamos.
    try {
      const { data, error } = await svc.rpc("sweep_pending_instagram_automation_links");
      if (error) throw new Error(errMessage(error));
      console.log(`[${CRON_NAME}] sweep_pending_instagram_automation_links: ${data ?? 0} vínculo(s) ligado(s)`);
    } catch (err) {
      console.error(`[${CRON_NAME}] sweep_pending_instagram_automation_links falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `sweep_pending_instagram_automation_links: ${errMessage(err)}` });
    }

    // 5. Retries: envios com retry vencido ou processing órfão (RPC, Task 3).
    try {
      const { data, error } = await svc.rpc("claim_retryable_automation_sends", { p_limit: RETRY_LIMIT });
      if (error) throw new Error(errMessage(error));
      const claimed = (data ?? []) as ClaimedSend[];
      if (claimed.length > 0) console.log(`[${CRON_NAME}] retries: ${claimed.length} envio(s) claimado(s)`);
      for (const send of claimed) {
        try {
          // deno-lint-ignore no-explicit-any
          await executeSend({ svc: svc as any, fetchFn: deps.fetchFn, decryptToken: decryptTokenFn, now }, send);
        } catch (err) {
          console.error(`[${CRON_NAME}] executeSend falhou (send ${send.send_id}):`, errMessage(err));
          failed++;
          errors.push({ accountId: send.send_id, error: `executeSend: ${errMessage(err)}` });
        }
      }
    } catch (err) {
      console.error(`[${CRON_NAME}] claim_retryable_automation_sends falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `claim_retryable_automation_sends: ${errMessage(err)}` });
    }

    // 6. Re-check diário de assinaturas: contas com AO MENOS uma automação
    // ativa cuja confirmação de subscribed_apps passou de 24h.
    try {
      const { data: automationRows, error: autoErr } = await svc
        .from("instagram_comment_automations")
        .select("client_id, conta_id")
        .eq("ativo", true);
      if (autoErr) throw new Error(errMessage(autoErr));
      const activeAutomations = (automationRows ?? []) as AutomationRefRow[];

      if (activeAutomations.length > 0) {
        // client_id -> conta_id é 1:1 (FK composta (client_id, conta_id) ->
        // clientes(id, conta_id), Task 2): qualquer automação do cliente serve
        // como representante para a notificação.
        const contaByClient = new Map<number, string>();
        for (const row of activeAutomations) {
          if (!contaByClient.has(row.client_id)) contaByClient.set(row.client_id, row.conta_id);
        }
        const clientIds = [...contaByClient.keys()];

        const subscriptionCutoff = new Date(nowDate.getTime() - SUBSCRIPTION_STALE_MS).toISOString();
        const { data: staleRows, error: acctErr } = await svc
          .from("instagram_accounts")
          .select("id, client_id, encrypted_access_token")
          .in("client_id", clientIds)
          .eq("authorization_status", "active")
          .lt("comments_subscribed_at", subscriptionCutoff);
        if (acctErr) throw new Error(errMessage(acctErr));
        const staleAccounts = (staleRows ?? []) as StaleAccountRow[];

        for (const account of staleAccounts) {
          try {
            const token = await decryptTokenFn(account.encrypted_access_token);
            const fields = await fetchSubscribedFields(msgDeps, token);
            if (fields.includes("comments")) {
              const { error } = await svc
                .from("instagram_accounts")
                .update({ comments_subscribed_at: nowDate.toISOString() })
                .eq("id", account.id);
              if (error) throw new Error(errMessage(error));
            } else {
              const { error } = await svc
                .from("instagram_accounts")
                .update({ comments_subscribed_at: null })
                .eq("id", account.id);
              if (error) throw new Error(errMessage(error));
              const contaId = contaByClient.get(account.client_id);
              if (contaId) {
                // deno-lint-ignore no-explicit-any
                await notifyAutomationFailure(svc as any, {
                  contaId,
                  clientId: account.client_id,
                  reason: "subscription_lost",
                });
              }
            }
          } catch (err) {
            console.error(`[${CRON_NAME}] re-check de assinatura falhou (conta ${account.id}):`, errMessage(err));
            failed++;
            errors.push({ accountId: account.id, error: `subscription re-check: ${errMessage(err)}` });
          }
        }
      }
    } catch (err) {
      console.error(`[${CRON_NAME}] re-check de assinaturas falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `subscription re-check: ${errMessage(err)}` });
    }

    // 7. Purge: eventos já processados há mais de 30 dias.
    try {
      const purgeCutoff = new Date(nowDate.getTime() - PURGE_AGE_MS).toISOString();
      const { error } = await svc
        .from("instagram_webhook_events")
        .delete()
        .not("processed_at", "is", null)
        .lt("received_at", purgeCutoff);
      if (error) throw new Error(errMessage(error));
    } catch (err) {
      console.error(`[${CRON_NAME}] purge falhou:`, errMessage(err));
      failed++;
      errors.push({ error: `purge: ${errMessage(err)}` });
    }

    if (failed > 0) {
      await reportCronFailure(svc, CRON_NAME, { failed, errors });
    }

    return new Response(JSON.stringify({ ok: true, failed }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}
