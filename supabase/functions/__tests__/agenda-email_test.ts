import { assert, assertEquals } from "./assert.ts";
import { buildLembreteEmail } from "../_shared/agenda-email.ts";

const base = {
  titulo: "Gravação",
  inicio: "2026-10-05T17:00:00Z",
  fim: "2026-10-05T19:00:00Z",
  diaInteiro: false,
  local: null as string | null,
  linkReuniao: null as string | null,
  tz: "America/Sao_Paulo",
  minutos: 10,
  abrirUrl: "https://app.example.test/calendario?evento=7",
  appBaseUrl: "https://app.example.test",
};

Deno.test("buildLembreteEmail: subject by lead time", () => {
  assertEquals(buildLembreteEmail({ ...base, minutos: 10 }).subject, "Em 10 minutos: Gravação");
  assertEquals(buildLembreteEmail({ ...base, minutos: 60 }).subject, "Em 1 hora: Gravação");
  assertEquals(buildLembreteEmail({ ...base, minutos: 120 }).subject, "Em 2 horas: Gravação");
  assertEquals(buildLembreteEmail({ ...base, minutos: 1440 }).subject, "Amanhã: Gravação");
  assertEquals(buildLembreteEmail({ ...base, minutos: 0 }).subject, "Começando agora: Gravação");
  assertEquals(buildLembreteEmail({ ...base, diaInteiro: true, minutos: -540 }).subject, "Hoje: Gravação");
});

Deno.test("buildLembreteEmail: all-day copy", () => {
  const hoje = buildLembreteEmail({ ...base, diaInteiro: true, minutos: -540 });
  assert(hoje.html.includes("Lembrete: Gravação é hoje"));
  const amanha = buildLembreteEmail({ ...base, diaInteiro: true, minutos: 1440 });
  assert(amanha.html.includes("Lembrete: Gravação é amanhã"));
  assertEquals(amanha.subject, "Amanhã: Gravação");
});

Deno.test("buildLembreteEmail: timed heading and time range in the event tz", () => {
  const { html } = buildLembreteEmail({ ...base, minutos: 60 });
  assert(html.includes("Seu evento começa em 1 hora"));
  assert(html.includes("Segunda, 5 de outubro · 14:00 a 16:00"), html);
  const other = buildLembreteEmail({ ...base, tz: "UTC", minutos: 10 });
  assert(other.html.includes("17:00 a 19:00"));
});

Deno.test("buildLembreteEmail: subject goes through sanitizeSubjectValue", () => {
  const s = buildLembreteEmail({ ...base, titulo: "Linha 1\r\nBcc: x@y.z" }).subject;
  assert(!/[\r\n]/.test(s));
  const long = buildLembreteEmail({ ...base, titulo: "x".repeat(200) }).subject;
  assert(long.length < 120);
  assert(long.includes("…"));
});

Deno.test("buildLembreteEmail: escapes title and local", () => {
  const { html } = buildLembreteEmail({
    ...base,
    titulo: "<script>alert(1)</script>",
    local: "Sala <script>x</script>",
  });
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert(html.includes("Sala &lt;script&gt;x&lt;/script&gt;"));
});

Deno.test("buildLembreteEmail: only http(s) meeting links become anchors", () => {
  const bad = buildLembreteEmail({ ...base, linkReuniao: "javascript:alert(1)" }).html;
  assert(!bad.includes("javascript:"));
  assert(!bad.includes("Entrar na reunião"));
  const good = buildLembreteEmail({ ...base, linkReuniao: "https://meet.example.test/abc?x=1&y=2" }).html;
  assert(good.includes('<a href="https://meet.example.test/abc?x=1&amp;y=2"'));
  assert(good.includes("Entrar na reunião"));
});

Deno.test("buildLembreteEmail: CTA and footer", () => {
  const { html } = buildLembreteEmail(base);
  assert(html.includes('href="https://app.example.test/calendario?evento=7"'));
  assert(html.includes("Abrir na agenda"));
  assert(html.includes("Você recebe este lembrete porque participa deste evento. Para desligar, vá em Configurações, Notificações."));
  assert(!html.includes("—"));
});
