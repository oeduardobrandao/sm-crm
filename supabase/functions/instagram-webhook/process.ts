// supabase/functions/instagram-webhook/process.ts
// Processador de eventos do webhook de comentário -> DM. Para cada linha de
// `instagram_webhook_events`: resolve a(s) conta(s) candidata(s), casa
// automações ativas, faz o claim atômico do envio e roda a máquina de estados
// (`executeSend`, REUSADA pelo cron de retry, Task 10). `processDelivery`
// NUNCA lança: cada linha roda no seu próprio try/catch e um crash deixa
// `processed_at` NULL de propósito, para o sweep do cron reprocessar depois.
import type { EventRow } from "./handler.ts";
import { parseWebhookDelivery } from "./parse.ts";
import { matchesKeywords, pickWinner } from "../_shared/instagram-comment-matching.ts";
import type { AutomationCandidate } from "../_shared/instagram-comment-matching.ts";
import {
  classifyIgError,
  fetchComment,
  fetchReplies,
  replyToComment,
  sendPrivateReply,
} from "../_shared/instagram-messaging.ts";
import type { IgMessagingDeps } from "../_shared/instagram-messaging.ts";
import { decryptToken as defaultDecryptToken } from "../_shared/instagram-publish-utils.ts";
import { notifyAutomationFailure } from "../_shared/automation-notify.ts";

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any; rpc: (name: string, params: Record<string, unknown>) => any };

const AUTOMATION_SCOPE = "instagram_business_manage_comments";
const MAX_ATTEMPTS = 5;
const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias, janela da private reply

// Backoff exponencial em segundos: 1min, 5min, 15min, 1h, 6h. Índice = tentativas
// já feitas ANTES desta (attempts=0 -> 60s na primeira falha).
export const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600];

export interface ProcessDeps {
  fetchFn?: typeof fetch;
  decryptToken?: (t: string) => Promise<string>;
  now?: () => Date;
  hourlyCap?: number;
}

// Snapshot do claim, suficiente para rodar o envio sem re-derivar nada do
// evento original. `send_id` nulo nunca chega aqui: quem chama já tratou
// outcome 'duplicate'/'cooldown' antes de montar isto.
export interface ClaimedSend {
  send_id: string;
  comment_id: string;
  automation_id: string;
  conta_id: string;
  commenter_id: string | null;
  comment_created_at: string;
  dm_status: string | null;
  public_reply_status: string | null;
  attempts: number;
  encrypted_access_token: string;
  instagram_user_id: string;
}

interface SendContext {
  svc: DbClient;
  fetchFn?: typeof fetch;
  decryptToken: (t: string) => Promise<string>;
  now: () => Date;
}

interface EligibleAccount {
  id: string;
  client_id: number;
  instagram_user_id: string;
  encrypted_access_token: string;
}

interface AutomationRow extends AutomationCandidate {
  keywords: string[];
  dm_message: string;
  public_reply: string | null;
}

interface RevalidatedAutomation {
  ativo: boolean;
  dm_message: string;
  public_reply: string | null;
  client_id: number;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Mesmos critérios de aptidão em todo o módulo (candidatos do webhook e
// revalidação no envio): status ativo, escopo explícito, assinatura confirmada.
async function selectEligibleAccounts(
  svc: DbClient,
  filter: { instagramUserId?: string; clientId?: number },
): Promise<EligibleAccount[]> {
  // deno-lint-ignore no-explicit-any
  let q: any = svc
    .from("instagram_accounts")
    .select("id, client_id, instagram_user_id, encrypted_access_token")
    .eq("authorization_status", "active")
    .contains("permissions", [AUTOMATION_SCOPE])
    .not("comments_subscribed_at", "is", null);
  if (filter.instagramUserId !== undefined) q = q.eq("instagram_user_id", filter.instagramUserId);
  if (filter.clientId !== undefined) q = q.eq("client_id", filter.clientId);
  const { data, error } = await q;
  if (error) throw new Error(`instagram_accounts (candidatos): ${errMessage(error)}`);
  return (data ?? []) as EligibleAccount[];
}

async function hasEligibleAccount(svc: DbClient, clientId: number): Promise<boolean> {
  const { data, error } = await svc
    .from("instagram_accounts")
    .select("id")
    .eq("client_id", clientId)
    .eq("authorization_status", "active")
    .contains("permissions", [AUTOMATION_SCOPE])
    .not("comments_subscribed_at", "is", null)
    .maybeSingle();
  if (error) throw new Error(`instagram_accounts (aptidão): ${errMessage(error)}`);
  return !!data;
}

async function stampProcessed(svc: DbClient, rowId: string, now: Date): Promise<void> {
  const { error } = await svc
    .from("instagram_webhook_events")
    .update({ processed_at: now.toISOString() })
    .eq("id", rowId);
  if (error) throw new Error(`instagram_webhook_events (stamp): ${errMessage(error)}`);
}

interface RowCtx {
  decryptTokenFn: (t: string) => Promise<string>;
  now: () => Date;
  hourlyCap: number;
  msgDeps: IgMessagingDeps;
  fetchFn?: typeof fetch;
}

async function processRow(svc: DbClient, row: EventRow, ctx: RowCtx): Promise<void> {
  const nowDate = ctx.now();

  // 1. Candidatos: contas aptas para este ig_user_id.
  const candidates = await selectEligibleAccounts(svc, { instagramUserId: row.ig_user_id });
  if (candidates.length === 0) {
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // `raw` é o change ÚNICO já normalizado com sucesso na ingestão (handler.ts);
  // reembrulhar como uma entrega de 1 entry/1 change reusa o parser sem duplicar
  // sua lógica. Se por algum motivo não normalizar de novo, skip seguro.
  const [event] = parseWebhookDelivery({ entry: [{ id: row.ig_user_id, changes: [row.raw] }] });
  if (!event) {
    console.error(`[instagram-webhook] evento ${row.id} não reparseou; skip seguro`);
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // 2. Automações ativas dos clientes candidatos (todas — o throttle do passo 9
  // usa esta mesma lista, sem restringir por mídia).
  const candidateClientIds = [...new Set(candidates.map((c) => c.client_id))];
  const { data: automationRows, error: autoErr } = await svc
    .from("instagram_comment_automations")
    .select("id, conta_id, client_id, ig_media_id, keywords, dm_message, public_reply, created_at")
    .eq("ativo", true)
    .in("client_id", candidateClientIds);
  if (autoErr) throw new Error(`instagram_comment_automations: ${errMessage(autoErr)}`);
  const automationsAll = (automationRows ?? []) as AutomationRow[];
  const mediaId = event.mediaId ?? null;
  const automations = automationsAll.filter((a) => a.ig_media_id === null || a.ig_media_id === mediaId);

  // 3. Campos que faltam no payload -> GET de reconciliação (token do 1º candidato).
  // Gatilho = falta commenterId OU text: são exatamente os dois campos que a
  // checagem seguinte ("ainda indeterminado") volta a examinar depois do GET.
  // `parentId` NÃO entra no gatilho: sua ausência no payload da Meta É o sinal
  // normal de "comentário de primeiro nível" (não é campo obrigatório só em
  // replies) -- tratá-la como "faltando" acionaria o GET em todo comentário
  // comum, o caso mais frequente, sem necessidade. Quando o GET roda por outro
  // motivo, `parentId`/timestamp são enriquecidos de graça abaixo mesmo assim.
  let commenterId = event.commenterId;
  let commenterUsername = event.commenterUsername;
  let text = event.text;
  let parentId = event.parentId;
  const valueTimestamp = event.timestamp;
  let getTimestamp: string | undefined;

  if (commenterId === undefined || text === undefined) {
    const token = await ctx.decryptTokenFn(candidates[0].encrypted_access_token);
    const fetched = await fetchComment(ctx.msgDeps, { commentId: row.comment_id, token });
    commenterId = commenterId ?? fetched.from?.id;
    commenterUsername = commenterUsername ?? fetched.from?.username;
    text = text ?? fetched.text;
    parentId = parentId ?? fetched.parent_id;
    getTimestamp = fetched.timestamp;
  }

  // Ainda indeterminado após o GET (sem from ou sem text) -> não dá para decidir
  // com segurança; skip sem enviar DM.
  if (commenterId === undefined || text === undefined) {
    console.log(`[instagram-webhook] comentário ${row.comment_id} sem from/text mesmo após GET; skip seguro`);
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // 4. comment_created_at: timestamp do value, senão do GET, senão o instante
  // do processamento como aproximação conservadora.
  const commentCreatedAt = valueTimestamp ?? getTimestamp ?? nowDate.toISOString();

  // 5. Skips: comentário da própria conta (anti-loop) ou reply.
  if (commenterId === row.ig_user_id || parentId !== undefined) {
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // 6. Matching.
  const matched = automations.filter((a) => matchesKeywords(text as string, a.keywords));
  if (matched.length === 0) {
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // 7. Conflito cross-workspace: mais de uma workspace com automação casando
  // o mesmo comentário -> fail-closed, ninguém envia, notifica cada workspace.
  const contaIds = [...new Set(matched.map((m) => m.conta_id))];
  if (contaIds.length > 1) {
    for (const contaId of contaIds) {
      const representative = matched.find((m) => m.conta_id === contaId)!;
      await notifyAutomationFailure(svc, {
        contaId,
        clientId: representative.client_id,
        reason: "duplicate_account_conflict",
      });
    }
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // 8. Claim atômico (desempate determinístico primeiro).
  const winner = pickWinner<AutomationRow>(matched)!;
  const { data: claimRows, error: claimErr } = await svc.rpc("claim_automation_send", {
    p_comment_id: row.comment_id,
    p_automation_id: winner.id,
    p_conta_id: winner.conta_id,
    p_media_id: mediaId,
    p_commenter_id: commenterId,
    p_commenter_username: commenterUsername ?? null,
    p_comment_text: text,
    p_comment_created_at: commentCreatedAt,
  });
  if (claimErr) throw new Error(`claim_automation_send: ${errMessage(claimErr)}`);
  const claim = ((claimRows ?? []) as Array<{ send_id: string | null; outcome: string }>)[0];
  if (!claim || claim.outcome !== "claimed" || !claim.send_id) {
    await stampProcessed(svc, row.id, nowDate);
    return;
  }
  const sendId = claim.send_id;

  // 9. Throttle interno: sends com DM enviada na última hora, das automações
  // do mesmo cliente (não só a que casou). Consulta DEDICADA, sem filtro de
  // `ativo`: uma automação pausada continua contando para o teto -- ela pode
  // ter disparado 690 DMs e sido pausada logo depois, e uma segunda automação
  // ativa do MESMO cliente não pode contornar o teto só porque `automationsAll`
  // (passo 2, filtrada `ativo=true`) não a enxerga mais.
  const { data: clientAutomationRows, error: clientAutoErr } = await svc
    .from("instagram_comment_automations")
    .select("id")
    .eq("client_id", winner.client_id);
  if (clientAutoErr) {
    throw new Error(`instagram_comment_automations (throttle): ${errMessage(clientAutoErr)}`);
  }
  const clientAutomationIds = ((clientAutomationRows ?? []) as Array<{ id: string }>).map((a) => a.id);
  const hourAgoIso = new Date(nowDate.getTime() - 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await svc
    .from("instagram_automation_sends")
    .select("id", { count: "exact", head: true })
    .eq("dm_status", "sent")
    .gt("updated_at", hourAgoIso)
    .in("automation_id", clientAutomationIds);
  if (countErr) throw new Error(`instagram_automation_sends (throttle): ${errMessage(countErr)}`);
  if ((count ?? 0) >= ctx.hourlyCap) {
    const { error: throttleErr } = await svc
      .from("instagram_automation_sends")
      .update({ status: "retry", next_attempt_at: new Date(nowDate.getTime() + 10 * 60 * 1000).toISOString() })
      .eq("id", sendId);
    if (throttleErr) throw new Error(`instagram_automation_sends (throttle update): ${errMessage(throttleErr)}`);
    await stampProcessed(svc, row.id, nowDate);
    return;
  }

  // 10. Envio.
  const account = candidates.find((c) => c.client_id === winner.client_id)!;
  const send: ClaimedSend = {
    send_id: sendId,
    comment_id: row.comment_id,
    automation_id: winner.id,
    conta_id: winner.conta_id,
    commenter_id: commenterId,
    comment_created_at: commentCreatedAt,
    dm_status: null,
    public_reply_status: null,
    attempts: 0,
    encrypted_access_token: account.encrypted_access_token,
    instagram_user_id: account.instagram_user_id,
  };

  await executeSend({ svc, fetchFn: ctx.fetchFn, decryptToken: ctx.decryptTokenFn, now: ctx.now }, send);
  await stampProcessed(svc, row.id, nowDate);
}

export function createProcessDelivery(deps: ProcessDeps) {
  const rowCtx: RowCtx = {
    decryptTokenFn: deps.decryptToken ?? defaultDecryptToken,
    now: deps.now ?? (() => new Date()),
    hourlyCap: deps.hourlyCap ?? 700,
    msgDeps: { fetchFn: deps.fetchFn },
    fetchFn: deps.fetchFn,
  };

  // `InstagramWebhookDeps.processDelivery` (handler.ts, Task 8) tipa `svc` com um
  // `DbClient` mais estreito (só `from`, sem `rpc`) do que este módulo precisa
  // internamente. `any` aqui é o boundary deliberado com esse contrato mais
  // largo; o cast pra baixo devolve o tipo estrito (`from` + `rpc`) para todo o
  // resto do arquivo, incluindo `executeSend`.
  // deno-lint-ignore no-explicit-any
  return async (svc: any, rows: EventRow[]): Promise<void> => {
    const client = svc as DbClient;
    for (const row of rows) {
      try {
        await processRow(client, row, rowCtx);
      } catch (err) {
        // processed_at fica NULL de propósito: o sweep do cron reprocessa esta
        // linha depois. Nunca deixamos um crash subir e derrubar as demais.
        console.error(
          `[instagram-webhook] falha ao processar evento ${row.id} (comment ${row.comment_id}):`,
          errMessage(err),
        );
      }
    }
  };
}

// Máquina de estados do envio: reusada pelo cron de retry (Task 10) sobre
// sends claimados por `claim_retryable_automation_sends`. NÃO tem o mesmo
// contrato de "nunca lança" de `processDelivery` — quem chama (webhook ou
// cron) decide como lidar com uma falha inesperada de banco.
export async function executeSend(ctx: SendContext, send: ClaimedSend): Promise<void> {
  const nowDate = ctx.now();
  const msgDeps: IgMessagingDeps = { fetchFn: ctx.fetchFn };

  // 1. Revalidação: a automação precisa existir e estar ativa; a conta
  // precisa seguir apta. Usa os valores ATUAIS (edições valem até o envio real).
  const { data: automationData, error: autoErr } = await ctx.svc
    .from("instagram_comment_automations")
    .select("ativo, dm_message, public_reply, client_id")
    .eq("id", send.automation_id)
    .maybeSingle();
  if (autoErr) throw new Error(`instagram_comment_automations (revalidação): ${errMessage(autoErr)}`);

  const automation = automationData as RevalidatedAutomation | null;
  if (!automation || !automation.ativo) {
    const { error } = await ctx.svc
      .from("instagram_automation_sends")
      .update({ status: "skipped", skip_reason: "automation_inactive" })
      .eq("id", send.send_id);
    if (error) throw new Error(`instagram_automation_sends (skipped): ${errMessage(error)}`);
    return;
  }

  const apta = await hasEligibleAccount(ctx.svc, automation.client_id);
  if (!apta) {
    const { error } = await ctx.svc
      .from("instagram_automation_sends")
      .update({ status: "failed", error_code: "account_unauthorized" })
      .eq("id", send.send_id);
    if (error) throw new Error(`instagram_automation_sends (account_unauthorized): ${errMessage(error)}`);
    return;
  }

  // 2. Token (o já resolvido no claim; a revalidação acima só confirma aptidão).
  const token = await ctx.decryptToken(send.encrypted_access_token);

  // 3. DM (private reply). Retry com dm_status já 'sent' pula direto pra resposta pública.
  if (send.dm_status !== "sent") {
    try {
      await sendPrivateReply(msgDeps, {
        igUserId: send.instagram_user_id,
        token,
        commentId: send.comment_id,
        text: automation.dm_message,
      });
      const { error } = await ctx.svc.rpc("mark_automation_dm_sent", { p_send_id: send.send_id });
      if (error) throw new Error(`mark_automation_dm_sent: ${errMessage(error)}`);
    } catch (err) {
      const kind = classifyIgError(err);

      if (kind === "already_replied") {
        // Auto-correção: a Meta já tem uma private reply para este comentário
        // (só existe uma); registra como enviada e segue para a resposta pública.
        const { error } = await ctx.svc.rpc("mark_automation_dm_sent", { p_send_id: send.send_id });
        if (error) throw new Error(`mark_automation_dm_sent: ${errMessage(error)}`);
      } else if (kind === "token_expired") {
        const { error: acctErr } = await ctx.svc
          .from("instagram_accounts")
          .update({ authorization_status: "expired" })
          .eq("client_id", automation.client_id);
        if (acctErr) throw new Error(`instagram_accounts (expired): ${errMessage(acctErr)}`);
        await notifyAutomationFailure(ctx.svc, {
          contaId: send.conta_id,
          clientId: automation.client_id,
          reason: "token_expired",
        });
        const { error } = await ctx.svc
          .from("instagram_automation_sends")
          .update({ status: "failed", error_code: "token_expired" })
          .eq("id", send.send_id);
        if (error) throw new Error(`instagram_automation_sends (token_expired): ${errMessage(error)}`);
        return;
      } else if (kind === "transient" || kind === "timeout") {
        const commentTooOld = new Date(send.comment_created_at).getTime() <= nowDate.getTime() - RETRY_WINDOW_MS;
        if (send.attempts >= MAX_ATTEMPTS || commentTooOld) {
          const { error } = await ctx.svc
            .from("instagram_automation_sends")
            .update({ status: "failed", error_code: "retry_exhausted" })
            .eq("id", send.send_id);
          if (error) throw new Error(`instagram_automation_sends (retry_exhausted): ${errMessage(error)}`);
        } else {
          const backoffSeconds = BACKOFF_SECONDS[send.attempts];
          const nextAttemptAt = new Date(nowDate.getTime() + backoffSeconds * 1000).toISOString();
          const { error } = await ctx.svc
            .from("instagram_automation_sends")
            .update({ status: "retry", next_attempt_at: nextAttemptAt, attempts: send.attempts + 1 })
            .eq("id", send.send_id);
          if (error) throw new Error(`instagram_automation_sends (retry): ${errMessage(error)}`);
        }
        return;
      } else {
        // permanent
        const { error } = await ctx.svc
          .from("instagram_automation_sends")
          .update({ status: "failed", error_code: "dm_permanent" })
          .eq("id", send.send_id);
        if (error) throw new Error(`instagram_automation_sends (dm_permanent): ${errMessage(error)}`);
        return;
      }
    }
  }

  // 4. Resposta pública (opcional; NÃO idempotente -> nunca reposta às cegas).
  // Estado em voo: 'unknown' é gravado ANTES de chamar a Graph API, nunca
  // depois. Se o comentário aceitar a reply mas o runtime morrer (ou o UPDATE
  // de sucesso falhar) antes de gravarmos 'sent', a reentrada encontra
  // `public_reply_status='unknown'` já persistido e SÓ reconcilia via GET
  // replies -- nunca chama `replyToComment` de novo.
  let finalPublicReplyStatus = send.public_reply_status;
  if (automation.public_reply && send.public_reply_status !== "sent") {
    if (send.public_reply_status === "unknown") {
      // Reentrada após uma tentativa anterior que já pode ter postado (crash
      // ou falha de persistência entre o POST e o UPDATE de sucesso): nunca
      // reposta, só reconcilia via GET replies.
      let found: { id: string } | undefined;
      try {
        const replies = await fetchReplies(msgDeps, { commentId: send.comment_id, token });
        found = replies.find(
          (r) => r.from?.id === send.instagram_user_id && r.text === automation.public_reply,
        );
      } catch (reconcileErr) {
        console.error(
          `[instagram-webhook] fetchReplies falhou na reconciliação (reentrada) do send ${send.send_id}:`,
          errMessage(reconcileErr),
        );
      }
      if (found) {
        const { error } = await ctx.svc
          .from("instagram_automation_sends")
          .update({ public_reply_id: found.id, public_reply_status: "sent" })
          .eq("id", send.send_id);
        if (error) throw new Error(`instagram_automation_sends (public_reply reconciled): ${errMessage(error)}`);
        finalPublicReplyStatus = "sent";
      }
      // Não achou -> mantém 'unknown' (já é o valor persistido; nada a regravar).
    } else {
      // Primeira tentativa (public_reply_status ainda null, ou 'failed' de uma
      // rodada anterior confirmada sem post). Grava o estado em voo ANTES da
      // chamada externa -- se este UPDATE falhar, nem tentamos `replyToComment`:
      // deixamos a exceção subir (mesmo tratamento de qualquer erro de banco
      // neste arquivo) para a linha ser reprocessada depois, em vez de arriscar
      // um POST sem registro do estado em voo.
      const { error: markErr } = await ctx.svc
        .from("instagram_automation_sends")
        .update({ public_reply_status: "unknown" })
        .eq("id", send.send_id);
      if (markErr) {
        throw new Error(`instagram_automation_sends (public_reply em voo): ${errMessage(markErr)}`);
      }
      finalPublicReplyStatus = "unknown";

      try {
        const { replyId } = await replyToComment(msgDeps, {
          commentId: send.comment_id,
          token,
          text: automation.public_reply,
        });
        const { error } = await ctx.svc
          .from("instagram_automation_sends")
          .update({ public_reply_id: replyId, public_reply_status: "sent" })
          .eq("id", send.send_id);
        if (error) throw new Error(`instagram_automation_sends (public_reply sent): ${errMessage(error)}`);
        finalPublicReplyStatus = "sent";
      } catch (err) {
        const kind = classifyIgError(err);
        if (kind === "timeout") {
          // Resultado ambíguo: reconcilia via GET replies procurando a nossa
          // própria reply com o texto configurado. Sem achar (ou erro na
          // reconciliação) -> fica 'unknown' (já gravado acima), nunca posta de novo.
          let found: { id: string } | undefined;
          try {
            const replies = await fetchReplies(msgDeps, { commentId: send.comment_id, token });
            found = replies.find(
              (r) => r.from?.id === send.instagram_user_id && r.text === automation.public_reply,
            );
          } catch (reconcileErr) {
            console.error(
              `[instagram-webhook] fetchReplies falhou na reconciliação do send ${send.send_id}:`,
              errMessage(reconcileErr),
            );
          }
          if (found) {
            const { error } = await ctx.svc
              .from("instagram_automation_sends")
              .update({ public_reply_id: found.id, public_reply_status: "sent" })
              .eq("id", send.send_id);
            if (error) {
              throw new Error(`instagram_automation_sends (public_reply reconciled): ${errMessage(error)}`);
            }
            finalPublicReplyStatus = "sent";
          }
        } else {
          const { error } = await ctx.svc
            .from("instagram_automation_sends")
            .update({ public_reply_status: "failed" })
            .eq("id", send.send_id);
          if (error) throw new Error(`instagram_automation_sends (public_reply failed): ${errMessage(error)}`);
          finalPublicReplyStatus = "failed";
        }
      }
    }
  }

  // 5. Fechamento.
  const closingStatus = !automation.public_reply || finalPublicReplyStatus === "sent" ? "sent" : "sent_partial";
  const { error: closeErr } = await ctx.svc
    .from("instagram_automation_sends")
    .update({ status: closingStatus })
    .eq("id", send.send_id)
    .eq("status", "processing");
  if (closeErr) throw new Error(`instagram_automation_sends (fechamento): ${errMessage(closeErr)}`);
}
