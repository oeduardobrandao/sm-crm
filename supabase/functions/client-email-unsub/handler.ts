/**
 * client-email-unsub: client-facing one-click opt-out for the "pendências do
 * Hub" digest email (client-event-email-cron). Routes on the SAME path the
 * cron builds -- `${SUPABASE_URL}/functions/v1/client-email-unsub/<token>`
 * (client-event-email-cron/handler.ts) -- which is also where RFC 8058's
 * List-Unsubscribe-Post header sends its One-Click POST. Token is the last
 * path segment; no other routing is needed.
 *
 * GET renders a confirmation page and NEVER mutates -- link scanners and
 * prefetchers follow GET requests, and a mutating GET would silently opt a
 * client out without them ever seeing the page. POST -- from either the
 * rendered form's submit or a mail client's bodyless One-Click request --
 * flips send_event_email=false and stamps event_email_unsub_at, and is
 * deliberately idempotent: a replay (double submit, a retried One-Click)
 * just writes the same values again, no error.
 *
 * No CSRF protection on the POST, on purpose: RFC 8058 ss3.1 requires this
 * endpoint accept a bodyless POST from a mail client, which cannot carry a
 * CSRF token at all, and the action itself is a pure, idempotent opt-out
 * with no destructive or financial effect -- an attacker who already has the
 * (unguessable, HMAC-signed) token can open the GET confirmation page
 * anyway, so a forged cross-site POST gains nothing a forged GET-then-click
 * couldn't already get. This mirrors every commercial ESP's one-click
 * unsubscribe endpoint.
 *
 * Two token kinds (Agenda sub-project 4, spec §3.6): `{c: clienteId}` opts a
 * Hub client out of the client e-mails (the update below), `{g: convidadoId}`
 * blocks an external Agenda guest's address for that workspace through
 * `agenda_convite_descadastrar` (row in `agenda_convidados_bloqueio`; the
 * invite page itself keeps working). Same path, same HMAC key, same GET/POST
 * contract, so a guest's RFC 8058 One-Click POST works exactly like a client's.
 *
 * Token verification: verifyUnsubTokenKind (_shared/client-event-email.ts)
 * returns `{ tipo, id } | null`, and id 0 is a technically valid id --
 * every check below uses `=== null`, never a truthiness check.
 *
 * The service-role update bypasses trg_cliente_notify_guard (migration
 * 20260904000001_client_event_emails.sql: `IF auth.role() = 'service_role'
 * THEN RETURN NEW`), so no extra RPC or role check is needed for the write.
 */

import type { UnsubAlvo } from "../_shared/client-event-email.ts";

export interface ClientEmailUnsubDb {
  from(table: "clientes"): {
    update(patch: Record<string, unknown>): {
      eq(column: "id", value: number): {
        select(columns: "conta_id"): PromiseLike<
          { data: { conta_id: string }[] | null; error: { message: string } | null }
        >;
      };
    };
  };
}

export interface ClientEmailUnsubDeps {
  db: ClientEmailUnsubDb;
  /** verifyUnsubTokenKind from _shared/client-event-email.ts. */
  verifyToken: (token: string, secret: string) => Promise<UnsubAlvo | null>;
  /**
   * Blocks the guest's address for its workspace (`createDescadastrarConvidado`
   * below in production). Resolves the blocked `conta_id` for the audit entry,
   * or `null` when no table knows the id (the RPC also resolves a guest whose
   * series was deleted, through its surviving queue item). Throws on a
   * database error.
   */
  descadastrarConvidado: (convidadoId: number) => Promise<{ conta_id: string } | null>;
  /** TOKEN_ENCRYPTION_KEY, read via a throwing IIFE in index.ts. */
  tokenSecret: string;
  now: () => Date;
  auditLog: (entry: {
    conta_id?: string;
    action: string;
    resource_type: string;
    resource_id: string;
  }) => Promise<void>;
  buildCorsHeaders: (req: Request) => Record<string, string>;
}

// ─── pages: inline HTML, no external assets, PT-BR copy, no em-dash ───────
// Text is deliberately generic ("desta agência") -- the token only carries
// the cliente id, never the workspace name.

function page(title: string, heading: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  body { margin: 0; padding: 40px 20px; background: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; }
  .card { max-width: 420px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); text-align: center; }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; line-height: 1.6; color: #4b5563; margin: 0 0 20px; }
  button { background: #111827; color: #ffffff; border: none; border-radius: 8px; padding: 12px 24px; font-size: 14px; font-weight: 600; cursor: pointer; }
</style>
</head>
<body>
<div class="card">
<h1>${heading}</h1>
${body}
</div>
</body>
</html>`;
}

function confirmPage(): string {
  return page(
    "Cancelar avisos",
    "Deixar de receber estes avisos?",
    `<p>Você vai parar de receber e-mails de pendências desta agência.</p>
<form method="post"><button type="submit">Cancelar avisos</button></form>`,
  );
}

function confirmPageConvidado(): string {
  return page(
    "Cancelar avisos",
    "Deixar de receber estes avisos?",
    `<p>Você vai parar de receber convites e avisos de eventos desta agência neste endereço.</p>
<form method="post"><button type="submit">Cancelar avisos</button></form>`,
  );
}

function donePage(): string {
  return page("Pronto", "Pronto.", `<p>Você não vai mais receber estes avisos.</p>`);
}

function invalidPage(): string {
  return page("Link inválido", "Link inválido", `<p>Este link não é válido.</p>`);
}

function errorPage(): string {
  return page(
    "Algo deu errado",
    "Algo deu errado",
    `<p>Não foi possível processar seu pedido agora. Tente novamente mais tarde.</p>`,
  );
}

function html(body: string, status: number, cors: Record<string, string>): Response {
  return new Response(body, {
    status,
    headers: { ...cors, "Content-Type": "text/html; charset=utf-8" },
  });
}

export function createClientEmailUnsubHandler(deps: ClientEmailUnsubDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);

    if (req.method !== "GET" && req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método não permitido." }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const token = pathParts[pathParts.length - 1] ?? "";

    // The id can be 0 -- a technically valid id. Only `=== null` means
    // "invalid token"; a truthiness check would wrongly 404 that row.
    const alvo = await deps.verifyToken(token, deps.tokenSecret);
    if (alvo === null) {
      return html(invalidPage(), 404, cors);
    }

    if (req.method === "GET") {
      // NEVER mutates -- see file header.
      return html(alvo.tipo === "convidado" ? confirmPageConvidado() : confirmPage(), 200, cors);
    }

    if (alvo.tipo === "convidado") {
      // POST, guest: idempotent (`ON CONFLICT DO NOTHING` in the RPC), same
      // no-CSRF reasoning as the client path.
      let row: { conta_id: string } | null;
      try {
        row = await deps.descadastrarConvidado(alvo.id);
      } catch (e) {
        console.error("[client-email-unsub] guest block failed:", e instanceof Error ? e.message : String(e));
        return html(errorPage(), 500, cors);
      }
      // An id no table knows blocks nothing and audits nothing; the page never
      // reveals whether the id exists.
      if (row) {
        try {
          await deps.auditLog({
            conta_id: row.conta_id,
            action: "agenda_convidado_descadastro",
            resource_type: "agenda_convidado",
            resource_id: String(alvo.id),
          });
        } catch (e) {
          console.error("[client-email-unsub] audit log failed:", e instanceof Error ? e.message : String(e));
        }
      }
      return html(donePage(), 200, cors);
    }

    const clienteId = alvo.id;

    // POST: idempotent mutation, no CSRF token required -- see file header.
    // .select("conta_id") rides the same round trip as the update (no
    // second query) so the audit entry can carry conta_id -- without it the
    // row is invisible to every workspace's own audit view (owner_admin_select
    // filters by conta_id). Read with `data?.[0]`, NEVER `.single()`: a
    // client deleted between token issuance and click makes the update match
    // zero rows, which .single() would surface as an error (-> a spurious
    // 500) instead of the harmless no-op it actually is.
    let updatedRow: { conta_id: string } | undefined;
    try {
      const { data, error } = await deps.db.from("clientes")
        .update({ send_event_email: false, event_email_unsub_at: deps.now().toISOString() })
        .eq("id", clienteId)
        .select("conta_id");
      if (error) {
        console.error("[client-email-unsub] update failed:", error.message);
        return html(errorPage(), 500, cors);
      }
      updatedRow = data?.[0];
    } catch (e) {
      console.error("[client-email-unsub] update threw:", e instanceof Error ? e.message : String(e));
      return html(errorPage(), 500, cors);
    }

    // No row matched (client already deleted) -- nothing was updated, so
    // there is nothing to audit either. Still the generic success page: the
    // client's intent (no more emails) is already satisfied either way, and
    // this endpoint must never reveal whether a given id currently exists.
    if (updatedRow) {
      // insertAuditLog never throws (it catches internally) -- this wrap
      // mirrors the defensive style at the cron's own call site
      // (client-event-email-cron/handler.ts) rather than relying on that
      // contract silently.
      try {
        await deps.auditLog({
          conta_id: updatedRow.conta_id,
          action: "client_event_email_unsub",
          resource_type: "cliente",
          resource_id: String(clienteId),
        });
      } catch (e) {
        console.error("[client-email-unsub] audit log failed:", e instanceof Error ? e.message : String(e));
      }
    }

    return html(donePage(), 200, cors);
  };
}

// ─── guest block (production implementation of `descadastrarConvidado`) ──────

export interface DescadastrarConvidadoDb {
  rpc(
    fn: "agenda_convite_descadastrar",
    args: { p_convidado: number },
  ): PromiseLike<{ data: string | null; error: { message: string } | null }>;
}

/**
 * Calls the service-role `agenda_convite_descadastrar`, which resolves
 * `(conta_id, email)` from the guest row (removed rows included) or, when the
 * series DELETE cascaded the row away, from the newest queue item of that id,
 * inserts it into `agenda_convidados_bloqueio` and returns the `conta_id`
 * (for the audit entry). `null` = no table knows the id, nothing blocked.
 */
export function createDescadastrarConvidado(db: DescadastrarConvidadoDb) {
  return async (convidadoId: number): Promise<{ conta_id: string } | null> => {
    const { data, error } = await db.rpc("agenda_convite_descadastrar", { p_convidado: convidadoId });
    if (error) throw new Error(`agenda_convite_descadastrar failed: ${error.message}`);
    return typeof data === "string" && data !== "" ? { conta_id: data } : null;
  };
}
