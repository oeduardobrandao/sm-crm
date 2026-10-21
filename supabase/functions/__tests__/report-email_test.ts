import { assertStringIncludes, assert } from "jsr:@std/assert";
import { buildReportEmail, buildReportFrom, REPORT_FROM_ADDRESS } from "../_shared/report-template/email.ts";

const base = {
  clientName: "Marina Arrais", month: "2026-08", workspaceName: "DK",
  brandColor: "#e11d48", logoUrl: null, aiSummary: "Resumo do mês com tamanho suficiente.",
  pdfUrl: "https://x/r.pdf", hubUrl: "https://x/hub",
};

Deno.test("shell: faixa com brandColor, radius 12, sem rodapé creme nem tagline antiga", () => {
  const h = buildReportEmail(base);
  assertStringIncludes(h, "background: #e11d48");
  assertStringIncludes(h, "border-radius: 12px");
  assert(!h.includes("#f5f3ee"));
  assert(!h.includes("gestão inteligente"));
  assert(!h.includes("—"));
});
Deno.test("preheader: com delta de views usa o texto específico; sem, o fallback", () => {
  const com = buildReportEmail({ ...base, emailKpis: { views: { value: 48200, pct_change: 18 } } });
  assertStringIncludes(com, "Visualizações +18% em Agosto de 2026.");
  const sem = buildReportEmail(base);
  assertStringIncludes(sem, "Seu relatório de Agosto de 2026 está pronto.");
});
Deno.test("KPIs: 3 tiles com formato compacto e cores de delta; fila some sem dados", () => {
  const h = buildReportEmail({ ...base, emailKpis: {
    views: { value: 48200, pct_change: 18 },
    interactions: { value: 1240, pct_change: -9 },
    followers_gained: { value: 312 },
  }});
  assertStringIncludes(h, "48,2 mil");
  assertStringIncludes(h, "Visualizações");
  assertStringIncludes(h, "#15803d");       // +18 verde
  assertStringIncludes(h, ">-9%<");          // negativo presente...
  assert(!h.match(/-9%[^<]*#15803d/));       // ...mas nunca verde
  const semFila = buildReportEmail(base);
  assert(!semFila.includes("Visualizações"));
});
Deno.test("delta zero é NEUTRO: cinza, sem sinal, '0%' (nunca '+0%' verde) no tile e no preheader", () => {
  const h = buildReportEmail({ ...base, emailKpis: {
    views: { value: 48200, pct_change: 0 },
  }});
  assertStringIncludes(h, "Visualizações 0% em Agosto de 2026.");
  assertStringIncludes(h, 'color: #6b7280;">0%</p>');
  assert(!h.includes("+0%"));
  assert(!h.match(/#15803d[^<]*0%/));   // "0%" nunca sai verde
});
Deno.test("CTA: botão único com texto por luminância; PDF vira link", () => {
  const palida = buildReportEmail({ ...base, brandColor: "#fef3c7" });
  assertStringIncludes(palida, 'bgcolor="#fef3c7"');
  assertStringIncludes(palida, "color: #171717;");
  assert(!palida.includes('background: #1f2937'));     // botão escuro sumiu
  assertStringIncludes(palida, ">Baixar em PDF</a>");  // virou link de texto
});
Deno.test("eyebrow com o mês; bloco de IA continua neutro com corte de 300", () => {
  const h = buildReportEmail({ ...base, aiSummary: "x".repeat(400) });
  assertStringIncludes(h, "Relatório mensal");
  assert(h.includes("Destaque do mês"));
  assert(!h.includes("x".repeat(301)));
});

Deno.test("report: 0..3 KPI tiles, CTA in sentence case, no unsubscribe link, color-scheme", () => {
  const base = { clientName: "Ana Lima", month: "2026-09", workspaceName: "Agência L", brandColor: "#7c3aed", logoUrl: null, aiSummary: null, pdfUrl: "https://x.test/r.pdf", hubUrl: "https://x.test/hub" };
  const none = buildReportEmail({ ...base, emailKpis: null });
  assert(!none.includes("Visualizações"), "no KPI row without kpis");
  const one = buildReportEmail({ ...base, emailKpis: { views: { value: 48200 } } });
  assert(one.includes("48,2 mil") && !one.includes("Interações"));
  const h = buildReportEmail({ ...base, emailKpis: { views: { value: 1, pct_change: 5 }, interactions: { value: 2 }, followers_gained: { value: 3 } } });
  assert(h.includes("Ver relatório completo") && !h.includes("Ver Relatório Completo"));
  assert(h.includes("Baixar em PDF") && !h.includes("Não quero mais receber"));
  assert(h.includes(`<meta name="color-scheme" content="light">`));
});

Deno.test("From: nome hostil do workspace não injeta header nem forja outro endereço", () => {
  const from = buildReportFrom('Evil\r\nBcc: attacker@evil.test" <attacker@evil.test>');
  assert(!from.includes("\r") && !from.includes("\n"), "CR/LF sobreviveu no From");
  assert(from.endsWith(` <${REPORT_FROM_ADDRESS}>`), "endereço remetente foi trocado");
  assert(from === '"Evil Bcc: attacker@evil.test\\" <attacker@evil.test>" <relatorios@mesaas.com.br>');
});
Deno.test("From: nome normal vira quoted-string; null/vazio cai em Mesaas", () => {
  assert(buildReportFrom("Silva, Souza & Cia") === '"Silva, Souza & Cia" <relatorios@mesaas.com.br>');
  assert(buildReportFrom(null) === '"Mesaas" <relatorios@mesaas.com.br>');
  assert(buildReportFrom("   ") === '"Mesaas" <relatorios@mesaas.com.br>');
});
