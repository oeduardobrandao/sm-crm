/**
 * Single classifier for transactional e-mails sent through Resend. Order of
 * precedence: known `type` tag, then sender address, then subject (for the
 * shared founder sender). Subjects are never copied here: every matcher is
 * derived from the same constants/builders the senders use.
 */
import { clientEventSubject } from "./client-event-email.ts";
import { CONNECT_LINK_SUBJECT, CONNECTED_NOTICE_SUBJECT } from "./instagram-connect-email.ts";
import { DEMO_ACCESS_SUBJECT } from "./invite-email.ts";
import { THANKYOU_SUBJECT, trialReminderSubject, WELCOME_SUBJECT } from "./lifecycle-emails.ts";
import { NURTURE_STEPS, nurtureSubject } from "./nurture-emails.ts";
import { REPORT_FROM_ADDRESS } from "./report-template/email.ts";

export type EmailCategory =
  | "notificacoes"
  | "ciclo_de_vida"
  | "convites"
  | "cobranca"
  | "relatorios"
  | "afiliados"
  | "interno"
  | "externo"
  | "outros";

export type EmailEvent =
  | "sent"
  | "delivery_delayed"
  | "delivered"
  | "failed"
  | "suppressed"
  | "canceled"
  | "bounced"
  | "complained";

export const EMAIL_TYPES: Record<string, EmailCategory> = {
  notification_digest: "notificacoes",
  client_event: "notificacoes",
  agenda_lembrete: "notificacoes",
  agenda_cliente: "notificacoes",
  welcome: "ciclo_de_vida",
  thank_you: "ciclo_de_vida",
  trial_reminder: "ciclo_de_vida",
  nurture_a1: "ciclo_de_vida",
  nurture_a2: "ciclo_de_vida",
  nurture_a3: "ciclo_de_vida",
  nurture_a3_b1: "ciclo_de_vida",
  nurture_a4: "ciclo_de_vida",
  nurture_b1: "ciclo_de_vida",
  nurture_b2: "ciclo_de_vida",
  nurture_b3: "ciclo_de_vida",
  nurture_b4: "ciclo_de_vida",
  nurture_a4_b4: "ciclo_de_vida",
  instagram_connect: "ciclo_de_vida",
  instagram_connected: "ciclo_de_vida",
  invite: "convites",
  demo_access: "convites",
  dunning: "cobranca",
  report: "relatorios",
  affiliate_link: "afiliados",
  founder_signup: "interno",
  founder_subscription: "interno",
  cron_failure: "interno",
  retention_radar: "interno",
};

const DOMAIN = "mesaas.com.br";
const SENTINEL = "§";

/** Lower-cased address from `Name <addr>` or a bare address. */
function addressOf(from: string): string {
  const m = from.match(/<([^>]*)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

type SubjectMatcher = { type: string; test: (s: string) => boolean };

/** Matches `subjectFor(SENTINEL)` with the sentinel replaced by anything. */
function sentinelMatcher(type: string, subjectFor: (v: string) => string): SubjectMatcher {
  const [pre, post] = subjectFor(SENTINEL).split(SENTINEL);
  return { type, test: (s) => s.length >= pre.length + post.length && s.startsWith(pre) && s.endsWith(post) };
}

function exact(type: string, subject: string): SubjectMatcher {
  return { type, test: (s) => s === subject };
}

function trialMatcher(): SubjectMatcher {
  const [pre, post] = trialReminderSubject(null, 123456).split("123456");
  const head = pre.split(" termina em ")[0];
  return {
    type: "trial_reminder",
    test: (s) => s.startsWith(head) && s.includes(" termina em ") && s.endsWith(post),
  };
}

function nurtureMatchers(): SubjectMatcher[] {
  const out: SubjectMatcher[] = [];
  const a3 = nurtureSubject("a3", { clientCount: 0 });
  const b1Zero = nurtureSubject("b1", { clientCount: 0 });
  const a4 = nurtureSubject("a4", { clientCount: 0 });
  const b4 = nurtureSubject("b4", { clientCount: 0 });
  // Steps whose subjects collide are one indistinguishable type (a4/b4, a3/b1 with no clients).
  const shared = (x: string, y: string) => x === y;
  for (const step of NURTURE_STEPS) {
    const s = nurtureSubject(step, { clientCount: 0 });
    let type = `nurture_${step}`;
    if (step === "a4" || step === "b4") type = shared(a4, b4) ? "nurture_a4_b4" : type;
    if (step === "a3") type = shared(a3, b1Zero) ? "nurture_a3_b1" : type;
    if (step === "b1" && shared(a3, b1Zero)) continue;
    if (step === "b4" && shared(a4, b4)) continue;
    out.push(exact(type, s));
  }
  // b1 with clients: "Você já tem N cliente(s) ..."; N is the only variable part.
  const sample = nurtureSubject("b1", { clientCount: 7 });
  const re = new RegExp(
    `^${sample.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("7 clientes", "\\d+ clientes?")}$`,
  );
  out.push({ type: "nurture_b1", test: (s) => re.test(s) });
  return out;
}

const FOUNDER_SUBJECTS: SubjectMatcher[] = [
  exact("welcome", WELCOME_SUBJECT),
  exact("thank_you", THANKYOU_SUBJECT),
  trialMatcher(),
  ...nurtureMatchers(),
  sentinelMatcher("instagram_connect", CONNECT_LINK_SUBJECT),
  exact("instagram_connected", CONNECTED_NOTICE_SUBJECT),
];

const CLIENT_EVENT_MATCHER = sentinelMatcher("client_event", clientEventSubject);

function bySender(address: string, subject: string): { category: EmailCategory; type: string } {
  const [local, domain] = address.split("@");
  if (domain !== DOMAIN) return { category: "externo", type: "desconhecido" };
  switch (local) {
    case "alertas":
      return { category: "interno", type: "alerta_interno" };
    case "cobranca":
      return { category: "cobranca", type: "dunning" };
    case "afiliados":
      return { category: "afiliados", type: "affiliate_link" };
    case REPORT_FROM_ADDRESS.split("@")[0]:
      return { category: "relatorios", type: "report" };
    case "convites":
      return subject === DEMO_ACCESS_SUBJECT
        ? { category: "convites", type: "demo_access" }
        : { category: "convites", type: "invite" };
    case "notificacoes":
      return CLIENT_EVENT_MATCHER.test(subject)
        ? { category: "notificacoes", type: "client_event" }
        : { category: "notificacoes", type: "notificacao" };
    case "eduardo": {
      const hit = FOUNDER_SUBJECTS.find((m) => m.test(subject));
      return { category: "ciclo_de_vida", type: hit ? hit.type : "desconhecido" };
    }
    default:
      return { category: "outros", type: "desconhecido" };
  }
}

export function classifyEmail(
  p: { tags?: Record<string, string> | null; from: string; subject: string },
): { category: EmailCategory; type: string } {
  const tagged = p.tags?.type;
  if (tagged && Object.prototype.hasOwnProperty.call(EMAIL_TYPES, tagged)) {
    return { category: EMAIL_TYPES[tagged], type: tagged };
  }
  return bySender(addressOf(p.from), p.subject);
}

const EVENTS: ReadonlySet<string> = new Set([
  "sent",
  "delivery_delayed",
  "delivered",
  "failed",
  "suppressed",
  "canceled",
  "bounced",
  "complained",
]);

export function normalizeLastEvent(v: string): EmailEvent {
  if (v === "opened" || v === "clicked") return "delivered";
  if (EVENTS.has(v)) return v as EmailEvent;
  return "sent";
}

const SIGNED_EVENTS: ReadonlySet<string> = new Set([
  "sent",
  "delivered",
  "delivery_delayed",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

export function eventFromWebhookType(t: string): EmailEvent | null {
  if (!t.startsWith("email.")) return null;
  const e = t.slice("email.".length);
  return SIGNED_EVENTS.has(e) ? (e as EmailEvent) : null;
}

export const PII_EVENTS: ReadonlySet<EmailEvent> = new Set<EmailEvent>([
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

export { tagValue } from "./email-tag.ts";
