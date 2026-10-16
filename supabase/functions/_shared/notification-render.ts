import { getPublishErrorDisplay } from "./publish-error-codes.ts";

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

function ctx(a?: string, b?: string): string | undefined {
  return [a, b].filter(Boolean).join(" · ") || undefined;
}

function eventHeading(prefix: string, titulo?: string): string {
  return titulo ? `${prefix}: ${titulo}` : prefix;
}

/** Reminder lead, ported from the CRM's reminderPrefix. `minutos` = minutes before
 * start (negative = after). */
function reminderPrefix(m: Record<string, unknown> | null): string {
  const min = typeof m?.minutos === "number" ? m.minutos : null;
  if (min === null) return "Lembrete";
  const days = Math.ceil(min / 1440);
  if (m?.dia_inteiro === true) {
    if (min <= 0) return "Hoje";
    return days === 1 ? "Amanhã" : `Em ${days} dias`;
  }
  if (min <= 0) return "Agora";
  if (min >= 1440) return days === 1 ? "Amanhã" : `Em ${days} dias`;
  if (min >= 60 && min % 60 === 0) {
    const h = min / 60;
    return `Em ${h} ${h === 1 ? "hora" : "horas"}`;
  }
  return `Em ${min} ${min === 1 ? "minuto" : "minutos"}`;
}

/** Map a notification row to its text. Metadata keys are read defensively
 * (verified against the emitting triggers); anything missing degrades to a
 * generic line rather than throwing. Priority = urgency order. */
export function renderNotification(row: NotificationRow): RenderedNotification {
  const m = row.metadata;
  const link = row.link ?? "/";
  switch (row.type) {
    case "post_publish_failed": {
      const d = getPublishErrorDisplay(s(m, "publish_error_code"));
      return { priority: 1, heading: d.titulo, body: d.explicacao, context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    }
    case "post_correction":
      return { priority: 2, heading: "Correção solicitada pelo cliente", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "post_message":
      return { priority: 2, heading: "Nova mensagem no post", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "client_message":
      return { priority: 2, heading: "Nova mensagem do cliente", body: s(m, "comentario"), context: s(m, "client_name"), link };
    case "deadline_approaching":
      return { priority: 3, heading: "Prazo se aproximando", body: ctx(s(m, "workflow_title"), s(m, "step_name")), context: s(m, "client_name"), link };
    case "task_assigned":
      return { priority: 4, heading: "Tarefa atribuída a você", body: s(m, "task_title"), context: s(m, "client_name"), link };
    case "post_assigned":
      return { priority: 4, heading: "Post atribuído a você", body: s(m, "post_title"), context: s(m, "client_name"), link };
    case "mention":
      return { priority: 5, heading: `${s(m, "actor_name") ?? "Alguém"} mencionou você`, body: s(m, "excerpt"), context: s(m, "context_title"), link };
    case "post_approved":
      return { priority: 6, heading: "Post aprovado pelo cliente", body: s(m, "comentario"), context: ctx(s(m, "client_name"), s(m, "post_title")), link };
    case "event_invited":
      return { priority: 4, heading: `${s(m, "ator_nome") ?? "Alguém"} convidou você para um evento`, body: s(m, "titulo"), context: m?.recorrente === true ? "Evento recorrente" : undefined, link };
    case "event_updated":
      return { priority: 3, heading: eventHeading("Evento alterado", s(m, "titulo")), context: m?.recorrente === true ? "Evento recorrente" : undefined, link };
    case "event_cancelled": {
      // metadata.motivo is an enum ('removido' = you were taken off the event), never display text.
      const heading = s(m, "motivo") === "removido"
        ? `Você foi removido de ${s(m, "titulo") ?? "um evento"}`
        : eventHeading("Evento cancelado", s(m, "titulo"));
      return { priority: 3, heading, context: m?.recorrente === true ? "Evento recorrente" : undefined, link };
    }
    // The two client-side Agenda types have no actor (the Hub client is not a
    // user): the copy reads `cliente_nome` and never `ator_nome`. The metadata
    // carries no time zone, so `inicio`/`inicio_sugerido` are not rendered.
    case "event_client_rsvp": {
      const resposta = s(m, "resposta");
      const prefix = resposta === "sim"
        ? "Cliente confirmou presença"
        : resposta === "nao"
        ? "Cliente recusou o evento"
        : "Cliente respondeu ao evento";
      return { priority: 4, heading: eventHeading(prefix, s(m, "titulo")), context: s(m, "cliente_nome"), link };
    }
    // External guest answered on the public invite page (sub-project 4, spec
    // §3.8). Like the client types there is no actor: the guest is named by
    // `convidado_nome`, falling back to the address they were invited at.
    case "event_guest_rsvp": {
      const quem = s(m, "convidado_nome") ?? s(m, "convidado_email") ?? "Convidado";
      const resposta = s(m, "resposta");
      const prefix = resposta === "sim"
        ? `${quem} confirmou presença`
        : resposta === "nao"
        ? `${quem} recusou o evento`
        : `${quem} respondeu ao evento`;
      return { priority: 4, heading: eventHeading(prefix, s(m, "titulo")), context: "Convidado externo", link };
    }
    case "event_reschedule_requested":
      return {
        priority: 2,
        heading: eventHeading("Cliente pediu para remarcar", s(m, "titulo")),
        context: s(m, "cliente_nome"),
        link,
      };
    // Push-only types (not in the email digest's allowlist). Copy follows the
    // CRM bell (apps/crm/src/lib/notification-config.ts) without its em dashes.
    case "post_edit_suggestion":
      return {
        priority: 2,
        heading: m?.updated === true ? "Sugestão de edição atualizada" : "Sugestão de edição do cliente",
        context: ctx(s(m, "client_name"), s(m, "post_title")),
        link,
      };
    case "post_client_reference":
      return {
        priority: 5,
        heading: `${s(m, "client_name") ?? "Cliente"} enviou referências em ${s(m, "post_title") ?? "um post"}`,
        link,
      };
    case "idea_submitted":
      return {
        priority: 5,
        heading: s(m, "tipo") === "solicitacao" ? "Nova solicitação do cliente" : "Nova ideia do cliente",
        body: s(m, "idea_title"),
        context: s(m, "client_name"),
        link,
      };
    case "briefing_answered":
      return { priority: 5, heading: "Briefing respondido", body: s(m, "question_text"), context: s(m, "client_name"), link };
    // The metadata has no time zone for `inicio`, so the time is left to the
    // app; the lead ("Em 1 hora") already says when.
    case "event_reminder":
      return { priority: 2, heading: `${reminderPrefix(m)}: ${s(m, "titulo") ?? "Evento"}`, link };
    default:
      return { priority: 9, heading: "Nova notificação no Mesaas", context: undefined, link };
  }
}
