import { mesaasEmail } from "./email/shell.ts";
import { button, fallbackLink, heading, paragraph, paragraphHtml, strong } from "./email/blocks.ts";
import type { Lang } from "./i18n/lang.ts";
import { inviteText } from "./i18n/catalogs/invite.ts";

/**
 * Build the HTML body for a "set your password" invite e-mail. Text blocks escape their own
 * values (workspace name included), and the button and fallback link escape the action link
 * (it carries `&`-joined query params that must be entity-encoded in attribute context).
 */
export function buildInviteEmail(params: { actionLink: string; workspaceName: string; lang: Lang }): string {
  const t = inviteText(params.lang);
  return mesaasEmail({
    lang: params.lang,
    preheader: t.preheader(params.workspaceName),
    eyebrow: t.eyebrow,
    sections: [
      heading(t.heading(params.workspaceName)) +
        paragraphHtml(t.intro(strong(params.workspaceName)), "body", "0"),
      button(params.actionLink, t.cta) + fallbackLink(params.actionLink, params.lang) +
        paragraph(t.ignore, "small", "16px 0 0"),
    ],
    footerLines: [],
  });
}

/** Subject of the invite e-mail. */
export function inviteSubject(workspaceName: string, lang: Lang): string {
  return inviteText(lang).subject(workspaceName);
}

/**
 * Send the invite e-mail via Resend. Throws on misconfiguration or a non-2xx
 * response — invite-send failures must surface to the admin (unlike best-effort
 * cron alerts), so the caller can report that the resend did not go out.
 */
export async function sendInviteEmail(
  params: { to: string; actionLink: string; workspaceName: string; lang: Lang },
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Mesaas <convites@mesaas.com.br>",
      to: [params.to],
      subject: inviteSubject(params.workspaceName, params.lang),
      html: buildInviteEmail({
        actionLink: params.actionLink,
        workspaceName: params.workspaceName,
        lang: params.lang,
      }),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}

export type DemoSeedCounts = {
  membros: number;
  clientes: number;
  workflows: number;
  posts: number;
  ideias: number;
  leads: number;
  eventos: number;
};

/** "a, b e c" from the non-empty parts. */
function joinPt(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

function demoExamples(c: DemoSeedCounts): string[] {
  const out: string[] = [];
  if (c.membros > 0) out.push(c.membros === 1 ? "um membro da equipe" : "membros da equipe");
  if (c.clientes > 0) out.push(c.clientes === 1 ? "um cliente" : "clientes");
  if (c.workflows > 0) out.push(c.workflows === 1 ? "um fluxo" : "fluxos");
  if (c.posts > 0) out.push("posts");
  if (c.ideias > 0) out.push("ideias");
  if (c.leads > 0) out.push("leads");
  if (c.eventos > 0) out.push(c.eventos === 1 ? "um evento na agenda" : "eventos na agenda");
  return out;
}

export const DEMO_ACCESS_SUBJECT = "Sua conta Mesaas está pronta";

/**
 * HTML body of the "Sua conta Mesaas está pronta" e-mail sent when an admin creates a demo
 * account. Text blocks escape their own values; only seeded example kinds are listed.
 */
export function buildDemoAccessEmail(
  params: { actionLink: string; nome: string | null; planName: string; counts: DemoSeedCounts },
): string {
  const nome = params.nome?.trim();
  const greeting = nome ? `Olá, ${nome}.` : "Olá.";
  const examples = demoExamples(params.counts);
  const exemplos = examples.length
    ? ` Ela já vem com alguns exemplos (${joinPt(examples)}) para você explorar.`
    : "";
  return mesaasEmail({
    preheader: "Defina sua senha para entrar no Mesaas.",
    eyebrow: "Conta demo",
    sections: [
      heading("Sua conta Mesaas está pronta") +
        paragraph(
          `${greeting} Criamos uma conta no Mesaas para você testar, no plano ${params.planName}, sem custo.${exemplos} Defina sua senha para entrar.`,
          "body",
          "0",
        ),
      button(params.actionLink, "Definir minha senha") + fallbackLink(params.actionLink) +
        paragraph(
          "Este link expira. Se ele não funcionar mais, use “Esqueci minha senha” na página de login.",
          "small",
          "16px 0 0",
        ) +
        paragraph("Se você não esperava este e-mail, ignore esta mensagem.", "small", "8px 0 0"),
    ],
    footerLines: [],
  });
}

/** Send the demo access e-mail via Resend. Throws on misconfiguration or non-2xx. */
export async function sendDemoAccessEmail(
  params: { to: string; actionLink: string; nome: string | null; planName: string; counts: DemoSeedCounts },
): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Mesaas <convites@mesaas.com.br>",
      to: [params.to],
      subject: DEMO_ACCESS_SUBJECT,
      html: buildDemoAccessEmail(params),
    }),
  });
  if (!res.ok) throw new Error(`Resend send failed: ${res.status}`);
}
