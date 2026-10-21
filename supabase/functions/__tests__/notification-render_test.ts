import { assertEquals } from "./assert.ts";
import { renderNotification } from "../_shared/notification-render.ts";

const r = (type: string, metadata: Record<string, unknown> | null, link: string | null = "/x") =>
  renderNotification({ type, metadata, link });

Deno.test("push-only types render with the CRM bell's wording", () => {
  assertEquals(r("post_edit_suggestion", { client_name: "Sol", post_title: "Carrossel" }), {
    priority: 2, heading: "Sugestão de edição do cliente", context: "Sol · Carrossel", link: "/x",
  });
  assertEquals(r("post_edit_suggestion", { updated: true }).heading, "Sugestão de edição atualizada");
  assertEquals(r("post_client_reference", { client_name: "Sol", post_title: "Reels" }).heading, "Sol enviou referências em Reels");
  assertEquals(r("post_client_reference", null).heading, "Cliente enviou referências em um post");
  assertEquals(r("idea_submitted", { tipo: "solicitacao", idea_title: "Story", client_name: "Sol" }), {
    priority: 5, heading: "Nova solicitação do cliente", body: "Story", context: "Sol", link: "/x",
  });
  assertEquals(r("idea_submitted", {}).heading, "Nova ideia do cliente");
  assertEquals(r("briefing_answered", { question_text: "Tom de voz?", client_name: "Sol" }).body, "Tom de voz?");
});

Deno.test("event_reminder leads with when, ported from the CRM's reminderPrefix", () => {
  const h = (m: Record<string, unknown>) => r("event_reminder", { titulo: "Gravação", ...m }).heading;
  assertEquals(h({ minutos: 60 }), "Em 1 hora: Gravação");
  assertEquals(h({ minutos: 120 }), "Em 2 horas: Gravação");
  assertEquals(h({ minutos: 15 }), "Em 15 minutos: Gravação");
  assertEquals(h({ minutos: 1 }), "Em 1 minuto: Gravação");
  assertEquals(h({ minutos: 0 }), "Agora: Gravação");
  assertEquals(h({ minutos: 1440 }), "Amanhã: Gravação");
  assertEquals(h({ minutos: 2880 }), "Em 2 dias: Gravação");
  assertEquals(h({ minutos: 0, dia_inteiro: true }), "Hoje: Gravação");
  assertEquals(h({}), "Lembrete: Gravação");
  assertEquals(r("event_reminder", null).heading, "Lembrete: Evento");
});

Deno.test("a null link falls back to the app root and unknown types stay generic", () => {
  assertEquals(r("post_approved", null, null).link, "/");
  assertEquals(r("constructor", null).heading, "Nova notificação no Mesaas");
});
