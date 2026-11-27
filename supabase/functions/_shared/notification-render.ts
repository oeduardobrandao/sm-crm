import type { Lang } from "./i18n/lang.ts";
import { notificationsText } from "./i18n/catalogs/notifications.ts";

/** The columns every channel reads from a `notifications` row. */
export interface NotificationRow {
  type: string;
  metadata: Record<string, unknown> | null;
  link: string | null;
}

/** Channel-neutral text for one notification: the email digest adds a badge and
 * HTML, push maps heading/context/body to the APNs alert. */
export interface RenderedNotification {
  priority: number;
  heading: string;
  body?: string;
  context?: string;
  link: string;
}

function s(metadata: Record<string, unknown> | null, key: string): string | undefined {
  const v = metadata?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function n(metadata: Record<string, unknown> | null, key: string): number {
  const v = metadata?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function ctx(a?: string, b?: string): string | undefined {
  return [a, b].filter(Boolean).join(" · ") || undefined;
}

/** Month name of 'YYYY-MM-DD' in the given language, read from the text (no timezone shift). */
function monthName(periodo: string | undefined, lang: Lang): string {
  const mm = periodo ? /^\d{4}-(\d{2})/.exec(periodo) : null;
  return (mm && notificationsText(lang).months[Number(mm[1]) - 1]) || "";
}

function linhaEditorialItem(
  m: Record<string, unknown> | null,
  link: string,
  kind: "approved" | "adjust",
  lang: Lang,
): RenderedNotification {
  const t = notificationsText(lang);
  const mes = monthName(s(m, "periodo"), lang);
  const titulo = s(m, "titulo")?.trim();
  // Custom title (spec §14.2) in curly quotes, else the month.
  const ref = titulo ? t.refTitle(titulo) : mes ? t.refMonth(mes) : "";
  const n = typeof m?.comentarios === "number" ? m.comentarios : 0;
  const client = s(m, "cliente_nome") ?? t.client;
  return {
    priority: 4,
    heading: kind === "approved" ? t.linhaApproved(client, ref) : t.linhaAdjust(client, ref),
    body: n > 0 ? t.comments(n) : undefined,
    link,
  };
}

function eventHeading(prefix: string, lang: Lang, titulo?: string): string {
  return titulo ? notificationsText(lang).withTitle(prefix, titulo) : prefix;
}

/** Reminder lead, ported from the CRM's reminderPrefix. `minutos` = minutes before
 * start (negative = after). */
function reminderPrefix(m: Record<string, unknown> | null, lang: Lang): string {
  const t = notificationsText(lang);
  const min = typeof m?.minutos === "number" ? m.minutos : null;
  if (min === null) return t.reminderGeneric;
  const days = Math.ceil(min / 1440);
  if (m?.dia_inteiro === true) {
    if (min <= 0) return t.reminderToday;
    return days === 1 ? t.reminderTomorrow : t.reminderInDays(days);
  }
  if (min <= 0) return t.reminderNow;
  if (min >= 1440) return days === 1 ? t.reminderTomorrow : t.reminderInDays(days);
  if (min >= 60 && min % 60 === 0) return t.reminderInHours(min / 60);
  return t.reminderInMinutes(min);
}

/** Map a notification row to its text in the workspace language. Metadata keys
 * are read defensively (verified against the emitting triggers); anything
 * missing degrades to a generic line rather than throwing. Priority = urgency
 * order. */
export function renderNotification(row: NotificationRow, lang: Lang): RenderedNotification {
  const t = notificationsText(lang);
  const m = row.metadata;
  const link = row.link ?? "/";
  const recurring = m?.recorrente === true ? t.recurring : undefined;
  switch (row.type) {
    case "post_publish_failed": {
      const code = s(m, "publish_error_code");
      const copy = t.publishError;
      const d = code && Object.hasOwn(copy, code) ? copy[code] : copy.UNKNOWN;
      return { priority: 1, heading: d.titulo, body: d.explicacao, context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    }
    case "post_correction":
      return { priority: 2, heading: t.correction, body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "post_message":
      return { priority: 2, heading: t.postMessage, body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "client_message":
      return { priority: 2, heading: t.clientMessage, body: s(m, "comentario"), context: s(m, "client_name"), link };
    case "deadline_approaching":
      return { priority: 3, heading: t.deadline, body: ctx(s(m, "workflow_title"), s(m, "step_name")), context: s(m, "client_name"), link };
    case "task_assigned":
      return { priority: 4, heading: t.taskAssigned, body: s(m, "task_title"), context: s(m, "client_name"), link };
    case "post_assigned":
      return { priority: 4, heading: t.postAssigned, body: s(m, "post_title"), context: s(m, "client_name"), link };
    case "mention":
      return { priority: 5, heading: t.mentioned(s(m, "actor_name") ?? t.someone), body: s(m, "excerpt"), context: s(m, "context_title"), link };
    case "post_approved":
      return { priority: 6, heading: t.postApproved, body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "event_invited":
      return { priority: 4, heading: t.eventInvited(s(m, "ator_nome") ?? t.someone), body: s(m, "titulo"), context: recurring, link };
    case "event_updated":
      return { priority: 3, heading: eventHeading(t.eventUpdated, lang, s(m, "titulo")), context: recurring, link };
    case "event_cancelled": {
      // metadata.motivo is an enum ('removido' = you were taken off the event), never display text.
      const heading = s(m, "motivo") === "removido"
        ? t.removedFrom(s(m, "titulo") ?? t.anEvent)
        : eventHeading(t.eventCancelled, lang, s(m, "titulo"));
      return { priority: 3, heading, context: recurring, link };
    }
    // The two client-side Agenda types have no actor (the Hub client is not a
    // user): the copy reads `cliente_nome` and never `ator_nome`. The metadata
    // carries no time zone, so `inicio`/`inicio_sugerido` are not rendered.
    case "event_client_rsvp": {
      const resposta = s(m, "resposta");
      const prefix = resposta === "sim" ? t.clientRsvpYes : resposta === "nao" ? t.clientRsvpNo : t.clientRsvpOther;
      return { priority: 4, heading: eventHeading(prefix, lang, s(m, "titulo")), context: s(m, "cliente_nome"), link };
    }
    // External guest answered on the public invite page (sub-project 4, spec
    // §3.8). Like the client types there is no actor: the guest is named by
    // `convidado_nome`, falling back to the address they were invited at.
    case "event_guest_rsvp": {
      const quem = s(m, "convidado_nome") ?? s(m, "convidado_email") ?? t.guest;
      const resposta = s(m, "resposta");
      const prefix = resposta === "sim" ? t.guestRsvpYes(quem) : resposta === "nao" ? t.guestRsvpNo(quem) : t.guestRsvpOther(quem);
      return { priority: 4, heading: eventHeading(prefix, lang, s(m, "titulo")), context: t.externalGuest, link };
    }
    case "event_reschedule_requested":
      return {
        priority: 2,
        heading: eventHeading(t.reschedule, lang, s(m, "titulo")),
        context: s(m, "cliente_nome"),
        link,
      };
    case "linha_editorial_aprovada":
      return linhaEditorialItem(m, link, "approved", lang);
    case "linha_editorial_ajustes":
      return linhaEditorialItem(m, link, "adjust", lang);
    // Push-only types (not in the email digest's allowlist). Copy follows the
    // CRM bell (apps/crm/src/lib/notification-config.ts) without its em dashes.
    case "post_edit_suggestion":
      return {
        priority: 2,
        heading: m?.updated === true ? t.editSuggestionUpdated : t.editSuggestion,
        context: ctx(s(m, "client_name"), s(m, "post_title")),
        link,
      };
    case "post_client_reference":
      return {
        priority: 5,
        heading: t.clientReference(s(m, "client_name") ?? t.client, s(m, "post_title") ?? t.aPost),
        link,
      };
    case "post_material_complete": {
      const client = s(m, "client_name") ?? t.client;
      const post = s(m, "post_title") ?? t.aPost;
      const heading = s(m, "closed_by") === "client"
        ? t.materialPartial(client, n(m, "done"), n(m, "total"), post)
        : t.materialAll(client, post);
      return { priority: 5, heading, link };
    }
    case "idea_submitted":
      return {
        priority: 5,
        heading: s(m, "tipo") === "solicitacao" ? t.ideaRequest : t.ideaNew,
        body: s(m, "idea_title"),
        context: s(m, "client_name"),
        link,
      };
    case "briefing_answered":
      return { priority: 5, heading: t.briefing, body: s(m, "question_text"), context: s(m, "client_name"), link };
    // The metadata has no time zone for `inicio`, so the time is left to the
    // app; the lead ("Em 1 hora") already says when.
    case "event_reminder":
      return { priority: 2, heading: `${reminderPrefix(m, lang)}: ${s(m, "titulo") ?? t.eventFallback}`, link };
    default:
      return { priority: 9, heading: t.fallback, context: undefined, link };
  }
}

/** Language of a notification batch that spans workspaces: the majority wins,
 * a tie (and an empty batch) is Portuguese. */
export function majorityLang(langs: Lang[]): Lang {
  let en = 0;
  for (const l of langs) if (l === "en") en++;
  return en * 2 > langs.length ? "en" : "pt";
}
