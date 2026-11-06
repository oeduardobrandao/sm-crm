/**
 * nurture-unsub: one-click opt-out from the nurture emails sent to owners who
 * never subscribed (lifecycle-email-cron). The token (last path segment) is
 * `{u: profile uuid}` HMAC-signed by _shared/nurture-unsub-token.ts.
 *
 * GET renders a confirmation page and NEVER writes (link scanners prefetch
 * GETs). POST, from the page's form or a mail client's RFC 8058 One-Click
 * request, stamps profiles.nurture_opt_out_at. The `.is(..., null)` filter
 * keeps the FIRST opt-out timestamp, so a replay is a harmless no-op.
 *
 * No CSRF token on POST, on purpose: RFC 8058 requires accepting a bodyless
 * POST from a mail client, and the action is an idempotent opt-out guarded by
 * an unguessable signed token (same reasoning as client-email-unsub).
 */

import { verifyNurtureUnsubToken } from "../_shared/nurture-unsub-token.ts";

export interface NurtureUnsubDb {
  from(table: "profiles"): {
    update(patch: { nurture_opt_out_at: string }): {
      eq(column: "id", value: string): {
        is(column: "nurture_opt_out_at", value: null): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

export interface NurtureUnsubDeps {
  db: NurtureUnsubDb;
  tokenSecret: string;
  now: () => Date;
  buildCorsHeaders: (req: Request) => Record<string, string>;
}

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

const confirmPage = () =>
  page(
    "Parar de receber",
    "Parar de receber as dicas do Mesaas?",
    `<p>Você vai parar de receber os e-mails de dicas. E-mails da sua conta (convites, cobrança, avisos do teste) continuam chegando.</p>
<form method="post"><button type="submit">Parar de receber</button></form>`,
  );

const donePage = () =>
  page(
    "Pronto",
    "Pronto.",
    `<p>Pronto. Você não vai mais receber as dicas por e-mail. Dá pra religar em Configurações &gt; Notificações.</p>`,
  );

const invalidPage = () => page("Link inválido", "Link inválido", `<p>Este link não é válido.</p>`);

const errorPage = () =>
  page(
    "Algo deu errado",
    "Algo deu errado",
    `<p>Não foi possível processar seu pedido agora. Tente novamente mais tarde.</p>`,
  );

function html(body: string, status: number, cors: Record<string, string>): Response {
  return new Response(body, { status, headers: { ...cors, "Content-Type": "text/html; charset=utf-8" } });
}

export function createNurtureUnsubHandler(deps: NurtureUnsubDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    if (req.method !== "GET" && req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método não permitido." }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const token = parts[parts.length - 1] ?? "";

    const userId = await verifyNurtureUnsubToken(token, deps.tokenSecret);
    if (userId === null) return html(invalidPage(), 404, cors);

    if (req.method === "GET") return html(confirmPage(), 200, cors);

    try {
      const { error } = await deps.db.from("profiles")
        .update({ nurture_opt_out_at: deps.now().toISOString() })
        .eq("id", userId)
        .is("nurture_opt_out_at", null);
      if (error) {
        console.error("[nurture-unsub] update failed:", error.message);
        return html(errorPage(), 500, cors);
      }
    } catch (e) {
      console.error("[nurture-unsub] update threw:", e instanceof Error ? e.message : String(e));
      return html(errorPage(), 500, cors);
    }
    return html(donePage(), 200, cors);
  };
}
