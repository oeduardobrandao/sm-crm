/** Inputs for the notification pt-unchanged fixtures (fixtures/notifications-pt.json). */
import type { NotificationRow } from "../../_shared/notification-render.ts";

const PUBLISH_CODES = [
  "TOKEN_EXPIRED", "MEDIA_TOO_LARGE", "CAROUSEL_LIMIT", "NO_MEDIA", "MEDIA_UNSUPPORTED",
  "TRIAL_INELIGIBLE", "CAPTION_TOO_LONG", "ACCOUNT_RESTRICTED", "COLLABORATOR_INVALID",
  "CONTAINER_EXPIRED", "RATE_LIMIT", "IG_TRANSIENT", "INTERNAL", "UNKNOWN", "SOMETHING_ELSE",
];

const FULL = {
  client_name: "Clínica Aurora", post_title: "Post de maio", comentario: "Troque a foto da capa.",
  workflow_title: "Campanha", step_name: "Aprovação", task_title: "Revisar legenda",
  actor_name: "Ana", excerpt: "Veja isso @você", context_title: "Reunião de pauta",
  ator_nome: "Bruno", titulo: "Gravação", recorrente: true, cliente_nome: "Clínica Aurora",
  convidado_nome: "Carla", convidado_email: "carla@example.com", resposta: "sim",
  periodo: "2026-03-01", comentarios: 2, tipo: "solicitacao", idea_title: "Série de reels",
  question_text: "Qual o tom de voz?", done: 2, total: 5, closed_by: "client", updated: true,
};

const TYPES = [
  "post_publish_failed", "post_correction", "post_message", "client_message", "deadline_approaching",
  "task_assigned", "post_assigned", "mention", "post_approved", "event_invited", "event_updated",
  "event_cancelled", "event_client_rsvp", "event_guest_rsvp", "event_reschedule_requested",
  "linha_editorial_aprovada", "linha_editorial_ajustes", "post_edit_suggestion",
  "post_client_reference", "post_material_complete", "idea_submitted", "briefing_answered",
  "event_reminder", "something_unknown",
];

export const RENDER_CASES: Record<string, NotificationRow> = {};
for (const t of TYPES) {
  RENDER_CASES[`${t}/full`] = { type: t, metadata: { ...FULL, minutos: 60 }, link: "/x" };
  RENDER_CASES[`${t}/null`] = { type: t, metadata: null, link: null };
}
for (const c of PUBLISH_CODES) {
  RENDER_CASES[`publish/${c}`] = { type: "post_publish_failed", metadata: { publish_error_code: c, client_name: "A", post_title: "B" }, link: "/p" };
}
RENDER_CASES["publish/undefined"] = { type: "post_publish_failed", metadata: {}, link: "/p" };
for (const r of ["sim", "nao", "talvez"]) {
  RENDER_CASES[`event_client_rsvp/${r}`] = { type: "event_client_rsvp", metadata: { resposta: r, titulo: "T", cliente_nome: "C" }, link: "/" };
  RENDER_CASES[`event_guest_rsvp/${r}`] = { type: "event_guest_rsvp", metadata: { resposta: r, titulo: "T" }, link: "/" };
}
RENDER_CASES["event_guest_rsvp/email"] = { type: "event_guest_rsvp", metadata: { convidado_email: "g@example.com", resposta: "sim" }, link: "/" };
RENDER_CASES["event_cancelled/removido"] = { type: "event_cancelled", metadata: { motivo: "removido", titulo: "X" }, link: "/" };
RENDER_CASES["event_cancelled/removido-sem-titulo"] = { type: "event_cancelled", metadata: { motivo: "removido" }, link: "/" };
RENDER_CASES["event_cancelled/plain"] = { type: "event_cancelled", metadata: { titulo: "X" }, link: "/" };
RENDER_CASES["post_material_complete/ws"] = { type: "post_material_complete", metadata: { client_name: "A", post_title: "B", closed_by: "workspace" }, link: "/" };
RENDER_CASES["idea_submitted/ideia"] = { type: "idea_submitted", metadata: { tipo: "ideia", idea_title: "I", client_name: "C" }, link: "/" };
RENDER_CASES["post_edit_suggestion/new"] = { type: "post_edit_suggestion", metadata: { client_name: "A", post_title: "B" }, link: "/" };
RENDER_CASES["linha/title"] = { type: "linha_editorial_aprovada", metadata: { cliente_nome: "C", titulo: "  Linha de verão ", periodo: "2026-12-01", comentarios: 1 }, link: "/" };
RENDER_CASES["linha/dec"] = { type: "linha_editorial_ajustes", metadata: { cliente_nome: "C", periodo: "2026-12-01", comentarios: 1 }, link: "/" };
RENDER_CASES["linha/jan0"] = { type: "linha_editorial_aprovada", metadata: { cliente_nome: "C", periodo: "2026-01-15", comentarios: 0 }, link: "/" };
RENDER_CASES["linha/bad-period"] = { type: "linha_editorial_aprovada", metadata: { cliente_nome: "C", periodo: "xx" }, link: "/" };
const reminders: Array<[string, Record<string, unknown>]> = [
  ["none", {}], ["allday-0", { minutos: 0, dia_inteiro: true }], ["allday-neg", { minutos: -5, dia_inteiro: true }],
  ["allday-1d", { minutos: 600, dia_inteiro: true }], ["allday-3d", { minutos: 4000, dia_inteiro: true }],
  ["now", { minutos: 0 }], ["neg", { minutos: -10 }], ["tomorrow", { minutos: 1440 }], ["3d", { minutos: 4320 }],
  ["1h", { minutos: 60 }], ["2h", { minutos: 120 }], ["1min", { minutos: 1 }], ["45min", { minutos: 45 }],
  ["90min", { minutos: 90 }],
];
for (const [k, m] of reminders) {
  RENDER_CASES[`event_reminder/${k}`] = { type: "event_reminder", metadata: { ...m, titulo: "Call" }, link: "/" };
}

export const ITEMS = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    priority: i + 1,
    heading: `T${i + 1}`,
    body: i % 2 === 0 ? `Corpo ${i + 1}` : undefined,
    context: i % 3 === 0 ? `Ctx ${i + 1}` : undefined,
    link: `/l${i + 1}`,
    badge: i % 4 === 3 ? undefined : { tone: "info" as const, label: "Mensagem" },
  }));

export const DIGEST_SIZES = [1, 2, 3, 4, 25, 32];
export const BASE = "https://app.example.test";

export const PUSH_ROW = (over: Record<string, unknown>) => ({
  id: "n1", user_id: "u1", workspace_id: "w1", type: "mention",
  metadata: { actor_name: "Ana", excerpt: "oi", context_title: "Post" }, link: "/x",
  created_at: "2026-10-15T11:50:00.000Z", ...over,
});
export const PUSH_CASES: Record<string, Array<Record<string, unknown>>> = {
  single: [PUSH_ROW({})],
  two: [PUSH_ROW({ id: "a", type: "client_message", metadata: { client_name: "A", comentario: "x" } }), PUSH_ROW({ id: "b" })],
  five: ["a", "b", "c", "d", "e"].map((id, i) => PUSH_ROW({ id, type: "post_correction", metadata: { client_name: `C${i}`, post_title: "P", comentario: "x" } })),
  three: ["a", "b", "c"].map((id, i) => PUSH_ROW({ id, type: i === 0 ? "mention" : "task_assigned", metadata: { actor_name: `N${i}`, task_title: `Tarefa ${i}` } })),
};
