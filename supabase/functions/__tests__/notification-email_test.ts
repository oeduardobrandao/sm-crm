import { assert, assertEquals } from "./assert.ts";
import {
  buildDigestHtml,
  buildDigestIdempotencyKey,
  digestPreheader,
  digestSubject,
  resolveDigestItem,
  sendNotificationDigestEmail,
} from "../_shared/notification-email.ts";

Deno.test("resolveDigestItem: publish failure reuses getPublishErrorDisplay copy", () => {
  const item = resolveDigestItem({
    type: "post_publish_failed",
    metadata: { publish_error_code: "TOKEN_EXPIRED", client_name: "ACME", post_title: "Lançamento" },
    link: "/entregas?drawer=1&post=2",
  });
  assertEquals(item.priority, 1);
  assertEquals(item.heading, "Conexão com o Instagram expirou");
  assert(item.body!.includes("Reconecte"));
  assertEquals(item.context, "ACME · Lançamento");
  assertEquals(item.link, "/entregas?drawer=1&post=2");
});

Deno.test("resolveDigestItem: mention priority is last, uses actor + excerpt", () => {
  const item = resolveDigestItem({
    type: "mention",
    metadata: { actor_name: "Ana", context_title: "Post A", excerpt: "veja isso" },
    link: "/x",
  });
  assertEquals(item.priority, 5);
  assertEquals(item.heading, "Ana mencionou você");
  assertEquals(item.body, "veja isso");
  assertEquals(item.context, "Post A");
});

Deno.test("resolveDigestItem: post_approved vira boa notícia com prioridade 6", () => {
  const item = resolveDigestItem({
    type: "post_approved",
    metadata: { client_name: "Clínica Haven", post_title: "Post X" },
    link: "/entregas?post=1",
  });
  assertEquals(item.priority, 6);
  assertEquals(item.heading, "Post aprovado pelo cliente");
  assertEquals(item.context, "Clínica Haven · Post X");
});

Deno.test("resolveDigestItem: unknown/missing metadata degrades gracefully, no throw", () => {
  const item = resolveDigestItem({ type: "task_assigned", metadata: null, link: null });
  assertEquals(item.priority, 4);
  assertEquals(item.link, "/");
  assert(item.heading.length > 0);
});

Deno.test("digestSubject: single vs multiple", () => {
  const one = digestSubject([{ priority: 1, heading: "x", link: "/" }]);
  const many = digestSubject([
    { priority: 1, heading: "x", link: "/" },
    { priority: 2, heading: "y", link: "/" },
    { priority: 5, heading: "z", link: "/" },
  ]);
  assert(!one.includes("—"), "no em dash in subject");
  assertEquals(many, "Você tem 3 novidades no Mesaas");
});

Deno.test("buildDigestIdempotencyKey: stable for same id set, differs when it changes", async () => {
  const a = await buildDigestIdempotencyKey("u1", ["b", "a"]);
  const b = await buildDigestIdempotencyKey("u1", ["a", "b"]); // order-insensitive
  const c = await buildDigestIdempotencyKey("u1", ["a", "b", "c"]);
  assertEquals(a, b);
  assert(a !== c);
  assert(a.startsWith("notif-digest:u1:"));
});

Deno.test("sendNotificationDigestEmail: treats Resend 409 (key already accepted) as a deduped success, not a failure", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  const prevBase = Deno.env.get("APP_BASE_URL");
  Deno.env.set("RESEND_API_KEY", "test-key");
  Deno.env.set("APP_BASE_URL", "https://app.example.test");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response('{"name":"invalid_idempotent_request"}', { status: 409 }))) as typeof fetch;
  try {
    // Must NOT throw: a 409 means a prior retry already delivered this exact
    // digest under this idempotency key, so the claim should still be marked
    // sent (skipped: false), not released for a re-send loop.
    const result = await sendNotificationDigestEmail({
      to: "a@b.test",
      items: [{ priority: 1, heading: "x", link: "/" }],
      idempotencyKey: "notif-digest:u1:abc123",
    });
    assertEquals(result, { skipped: false });
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", prevKey);
    if (prevBase === undefined) Deno.env.delete("APP_BASE_URL");
    else Deno.env.set("APP_BASE_URL", prevBase);
  }
});

Deno.test("sendNotificationDigestEmail: a genuine non-2xx (500) still throws", async () => {
  const prevKey = Deno.env.get("RESEND_API_KEY");
  const prevBase = Deno.env.get("APP_BASE_URL");
  Deno.env.set("RESEND_API_KEY", "test-key");
  Deno.env.set("APP_BASE_URL", "https://app.example.test");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("nope", { status: 500 }))) as typeof fetch;
  let threw = false;
  try {
    await sendNotificationDigestEmail({
      to: "a@b.test",
      items: [{ priority: 1, heading: "x", link: "/" }],
      idempotencyKey: "notif-digest:u1:abc123",
    });
  } catch {
    threw = true;
  } finally {
    globalThis.fetch = originalFetch;
    if (prevKey === undefined) Deno.env.delete("RESEND_API_KEY");
    else Deno.env.set("RESEND_API_KEY", prevKey);
    if (prevBase === undefined) Deno.env.delete("APP_BASE_URL");
    else Deno.env.set("APP_BASE_URL", prevBase);
  }
  assert(threw, "expected a genuine non-2xx (500) to throw, not be swallowed like 409");
});

Deno.test("buildDigestHtml: escapes user-controlled heading/body, no raw <script> in output", () => {
  const html = buildDigestHtml(
    [
      {
        priority: 1,
        heading: '<script>alert(1)</script>',
        body: 'aspas " & "e-comercial"',
        link: "/x",
      },
    ],
    "https://app.example.test",
  );
  assert(!html.includes("<script>alert(1)</script>"), "raw <script> leaked into digest HTML unescaped");
  assert(html.includes("&lt;script&gt;"), "expected escaped heading in output");
  assert(html.includes("&amp;"), "expected escaped ampersand in output");
  assert(html.includes("&quot;"), "expected escaped quote in output");
});

Deno.test("resolveDigestItem: event_invited names the actor and escapes the title in the html", () => {
  const item = resolveDigestItem({
    type: "event_invited",
    metadata: { titulo: "Gravação <b>", inicio: "2026-10-05T17:00:00Z", ator_nome: "Bruno", recorrente: true },
    link: "/calendario?evento=1",
  });
  assertEquals(item.heading, "Bruno convidou você para um evento");
  assertEquals(item.link, "/calendario?evento=1");
  const html = buildDigestHtml([item], "https://app.example.test");
  assert(html.includes("Gravação &lt;b&gt;"));
  assert(!html.includes("Gravação <b>"));
});

Deno.test("resolveDigestItem: event_invited without actor degrades to a generic subject", () => {
  const item = resolveDigestItem({ type: "event_invited", metadata: null, link: null });
  assertEquals(item.heading, "Alguém convidou você para um evento");
  assertEquals(item.link, "/");
});

Deno.test("resolveDigestItem: event_updated and event_cancelled carry the title in the heading", () => {
  const upd = resolveDigestItem({ type: "event_updated", metadata: { titulo: "Reunião" }, link: "/calendario?evento=2" });
  assertEquals(upd.heading, "Evento alterado: Reunião");
  const can = resolveDigestItem({ type: "event_cancelled", metadata: { titulo: "Reunião" }, link: "/calendario?data=2026-10-05" });
  assertEquals(can.heading, "Evento cancelado: Reunião");
  assertEquals(can.link, "/calendario?data=2026-10-05");
  assert(!upd.heading.includes("—") && !can.heading.includes("—"));
});

Deno.test("resolveDigestItem: event_cancelled with motivo 'removido' says you were removed, never prints the enum", () => {
  const item = resolveDigestItem({
    type: "event_cancelled",
    metadata: { titulo: "Reunião", motivo: "removido" },
    link: "/calendario?data=2026-10-05",
  });
  assertEquals(item.heading, "Você foi removido de Reunião");
  assertEquals(item.body, undefined);
  const semTitulo = resolveDigestItem({ type: "event_cancelled", metadata: { motivo: "removido" }, link: null });
  assertEquals(semTitulo.heading, "Você foi removido de um evento");
});

Deno.test("resolveDigestItem: event_client_rsvp reads cliente_nome and resposta, never an actor", () => {
  const meta = {
    evento_id: 1,
    ocorrencia_id: 9,
    titulo: "Gravação <b>",
    inicio: "2026-10-09T17:00:00Z",
    cliente_nome: "Clínica X",
    ator_nome: "NUNCA",
  };
  const sim = resolveDigestItem({ type: "event_client_rsvp", metadata: { ...meta, resposta: "sim" }, link: "/calendario?evento=9" });
  assertEquals(sim.heading, "Cliente confirmou presença: Gravação <b>");
  assertEquals(sim.context, "Clínica X");
  assertEquals(sim.link, "/calendario?evento=9");
  assertEquals(sim.priority, 4);
  const nao = resolveDigestItem({ type: "event_client_rsvp", metadata: { ...meta, resposta: "nao" }, link: "/calendario?evento=9" });
  assertEquals(nao.heading, "Cliente recusou o evento: Gravação <b>");
  for (const it of [sim, nao]) {
    assert(!it.heading.includes("NUNCA") && !(it.context ?? "").includes("NUNCA"), "must not read ator_nome");
    assert(!it.heading.includes("—"));
  }
  const html = buildDigestHtml([sim], "https://app.example.test");
  assert(html.includes("Gravação &lt;b&gt;"));

  const vazio = resolveDigestItem({ type: "event_client_rsvp", metadata: null, link: null });
  assertEquals(vazio.heading, "Cliente respondeu ao evento");
  assertEquals(vazio.context, undefined);
  assertEquals(vazio.link, "/");
});

Deno.test("resolveDigestItem: event_reschedule_requested is actionable and has no actor", () => {
  const item = resolveDigestItem({
    type: "event_reschedule_requested",
    metadata: {
      evento_id: 1,
      ocorrencia_id: 9,
      titulo: "Gravação",
      inicio: "2026-10-09T17:00:00Z",
      inicio_sugerido: "2026-10-10T17:00:00Z",
      cliente_nome: "Clínica X",
    },
    link: "/calendario?evento=9",
  });
  assertEquals(item.heading, "Cliente pediu para remarcar: Gravação");
  assertEquals(item.context, "Clínica X");
  assertEquals(item.priority, 2);
  assertEquals(item.link, "/calendario?evento=9");
  const vazio = resolveDigestItem({ type: "event_reschedule_requested", metadata: null, link: null });
  assertEquals(vazio.heading, "Cliente pediu para remarcar");
  assertEquals(vazio.context, undefined);
});

Deno.test("resolveDigestItem: event_guest_rsvp names the guest by convidado_nome ?? convidado_email", () => {
  const meta = {
    evento_id: 1,
    ocorrencia_id: 9,
    titulo: "Gravação <b>",
    inicio: "2026-10-09T17:00:00Z",
    data_inicio_local: "2026-10-09",
    convidado_nome: "Bia Convidada",
    convidado_email: "bia@fora.test",
    ator_nome: "NUNCA",
  };
  const sim = resolveDigestItem({ type: "event_guest_rsvp", metadata: { ...meta, resposta: "sim" }, link: "/calendario?evento=9" });
  assertEquals(sim.heading, "Bia Convidada confirmou presença: Gravação <b>");
  assertEquals(sim.context, "Convidado externo");
  assertEquals(sim.link, "/calendario?evento=9");
  assertEquals(sim.priority, 4);
  const nao = resolveDigestItem({ type: "event_guest_rsvp", metadata: { ...meta, resposta: "nao" }, link: "/calendario?evento=9" });
  assertEquals(nao.heading, "Bia Convidada recusou o evento: Gravação <b>");

  const semNome = resolveDigestItem({
    type: "event_guest_rsvp",
    metadata: { ...meta, convidado_nome: null, resposta: "sim" },
    link: "/calendario?evento=9",
  });
  assertEquals(semNome.heading, "bia@fora.test confirmou presença: Gravação <b>");
  const nomeVazio = resolveDigestItem({
    type: "event_guest_rsvp",
    metadata: { ...meta, convidado_nome: "", resposta: "nao" },
    link: null,
  });
  assertEquals(nomeVazio.heading, "bia@fora.test recusou o evento: Gravação <b>");

  for (const it of [sim, nao, semNome]) {
    assert(!it.heading.includes("NUNCA") && !(it.context ?? "").includes("NUNCA"), "must not read ator_nome");
    assert(!it.heading.includes("—"));
  }
  assert(buildDigestHtml([sim], "https://app.example.test").includes("Gravação &lt;b&gt;"));

  const vazio = resolveDigestItem({ type: "event_guest_rsvp", metadata: null, link: null });
  assertEquals(vazio.heading, "Convidado respondeu ao evento");
  assertEquals(vazio.link, "/");
  assertEquals(vazio.priority, 4);
});

Deno.test("resolveDigestItem: every known type gets its badge", () => {
  const cases: Array<[string, string, string]> = [
    ["post_publish_failed", "danger", "Falha na publicação"], ["post_correction", "warning", "Correção"],
    ["post_approved", "success", "Aprovado"], ["post_message", "info", "Mensagem"], ["client_message", "info", "Mensagem"],
    ["mention", "info", "Menção"], ["deadline_approaching", "warning", "Prazo"], ["task_assigned", "neutral", "Tarefa"],
    ["post_assigned", "neutral", "Post"], ["event_invited", "neutral", "Agenda"], ["event_updated", "neutral", "Agenda"],
    ["event_cancelled", "neutral", "Agenda"], ["event_client_rsvp", "info", "Resposta"], ["event_guest_rsvp", "info", "Resposta"],
    ["event_reschedule_requested", "warning", "Remarcação"], ["algo_novo", "neutral", "Notificação"],
  ];
  for (const [type, tone, label] of cases) {
    const it = resolveDigestItem({ type, metadata: null, link: null });
    assertEquals(it.badge, { tone, label }, type);
  }
});

Deno.test("digestPreheader: 1, 3 and 25 items", () => {
  const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ priority: 1, heading: `T${i + 1}`, link: "/" }));
  assertEquals(digestPreheader(mk(1)), "T1.");
  assertEquals(digestPreheader(mk(3)), "T1, T2 e T3.");
  assertEquals(digestPreheader(mk(25)), "T1, T2, T3 e mais 22.");
});

Deno.test("buildDigestHtml: heading, badges, links, item without badge, 25 items all rendered", () => {
  const items = Array.from({ length: 25 }, (_, i) => ({ priority: 1, heading: `Item ${i + 1}`, link: `/x/${i}` }));
  const html = buildDigestHtml(items, "https://app.test");
  assert(html.includes("Você tem 25 novidades"));
  assertEquals((html.match(/Abrir no Mesaas/g) ?? []).length, 25);
  assert(html.includes(">Notificação<"), "missing badge falls back to neutral");
  assert(html.includes(`href="https://app.test/x/24"`));
  const one = buildDigestHtml([{ priority: 1, heading: "Só um", link: "/a", badge: { tone: "danger", label: "Falha na publicação" } }], "https://app.test");
  assert(one.includes("Você tem 1 novidade<") && one.includes("Falha na publicação"));
});

Deno.test("resolveDigestItem: a type that is an Object.prototype key falls back to the neutral badge", () => {
  const it = resolveDigestItem({ type: "constructor", metadata: null, link: null });
  assertEquals(it.badge, { tone: "neutral", label: "Notificação" });
});

Deno.test("buildDigestHtml: caps rendered rows below Gmail's clip and summarises the rest", () => {
  const items = Array.from({ length: 100 }, (_, i) => ({ priority: 1, heading: `Item ${i}`, link: `/x/${i}` }));
  const html = buildDigestHtml(items, "https://app.test");
  assertEquals(html.split(">Abrir no Mesaas<").length - 1, 30);
  assert(html.includes("Você tem 100 novidades"));
  assert(html.includes("E mais 70 notificações."));
  assert(html.includes(`href="https://app.test/dashboard"`));
  assert(new TextEncoder().encode(html).length < 102_400, "under Gmail clip");
  const small = buildDigestHtml(items.slice(0, 30), "https://app.test");
  assert(!small.includes("E mais"));
});
