import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNurtureEmail,
  NURTURE_SAMPLE,
  type NurtureEmailInput,
  type NurtureStep,
  nurtureUtm,
} from "../_shared/nurture-emails.ts";

const STEPS: NurtureStep[] = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];
const BASE = "https://app.example.com";
const UNSUB = "https://fn.example.com/unsub?t=abc&x=1";
const WA = "https://wa.me/5500000000000";

const mk = (step: NurtureStep, o: Partial<NurtureEmailInput> = {}) =>
  buildNurtureEmail({ ...NURTURE_SAMPLE, step, appBaseUrl: BASE, unsubUrl: UNSUB, whatsappUrl: WA, ...o });

Deno.test("nurtureUtm builds the tracked url", () => {
  assert(nurtureUtm(BASE, "/clientes", "a1") === `${BASE}/clientes?utm_source=email&utm_medium=nurture&utm_campaign=nurture_a1`);
});

Deno.test("every step has subject, utm links and the unsub footer", () => {
  for (const s of STEPS) {
    const { subject, html } = mk(s);
    assert(subject.length > 0, s);
    assert(html.includes(`href="${UNSUB.replace(/&/g, "&amp;")}"`), `${s} unsub href`);
    assert(html.includes("Descadastrar</a>."), s);
    assert(html.includes("Você recebeu este e-mail porque criou uma conta no Mesaas."), s);
    const links = [...html.matchAll(/href="(https:\/\/app\.example\.com[^"]*)"/g)].map((m) => m[1]);
    for (const l of links) assert(l.includes(`utm_campaign=nurture_${s}`), `${s} ${l}`);
    assert(!subject.includes("—") && !html.includes("—"), `${s} em-dash`);
  }
});

Deno.test("a3 trial line only before trial-first", () => {
  assert(mk("a3", { workspaceCreatedAt: "2026-10-01" }).html.includes("ainda não tinha teste grátis"));
  const tf = mk("a3", { workspaceCreatedAt: "2026-10-28T10:00:00Z" }).html;
  assert(!tf.includes("ainda não tinha teste grátis") && tf.includes("Dá pra testar o Mesaas inteiro por 30 dias"));
  assert(mk("a3", { firstName: null }).html.includes("Você pode testar tudo por 30 dias."));
});

Deno.test("b1 free-limit line only from 2 clients", () => {
  assert(mk("b1", { clientCount: 2 }).html.includes("limite do plano Free"));
  const one = mk("b1", { clientCount: 1 });
  assert(!one.html.includes("limite do plano Free"));
  assert(one.subject.includes("1 cliente no Mesaas"));
  assert(mk("b1", { clientCount: 2 }).subject.includes("2 clientes no Mesaas"));
  assert(mk("b1", { clientCount: 0 }).subject === "Teste tudo do Mesaas por 30 dias");
  assert(mk("b1", { firstName: null }).html.includes("A Agência Aurora já está no Mesaas."));
});

Deno.test("b2 names first client or falls back", () => {
  const named = mk("b2", { firstClientName: "Studio Bela" });
  assert(named.html.includes("para o Studio Bela"));
  const generic = mk("b2", { firstClientName: null });
  assert(!generic.html.includes("null") && !generic.html.includes("Studio Bela"));
  assert(generic.html.includes("o seu cliente"));
});

Deno.test("b3 instagram variant", () => {
  assert(mk("b3", { hasInstagram: true }).html.includes("já está conectado"));
  const no = mk("b3", { hasInstagram: false });
  assert(no.html.includes("Você conecta o Instagram do cliente uma vez") && !no.html.includes("já está conectado"));
});

Deno.test("a4/b4 whatsapp button only with url", () => {
  for (const s of ["a4", "b4"] as const) {
    assert(mk(s).html.includes("wa.me"));
    assert(!mk(s, { whatsappUrl: null }).html.includes("wa.me"));
  }
  assert(mk("b4", { workspaceName: "Zeta" }).html.includes("a Zeta já usa o Mesaas"));
});

Deno.test("user data is escaped", () => {
  const o = { firstName: "<img src=x onerror=alert(1)>", workspaceName: "Aurora\r\nBcc: x", firstClientName: '"><script>' };
  for (const s of STEPS) {
    const { subject, html } = mk(s, o);
    assert(!html.includes("<img src=x") && !html.includes("<script>"), s);
    assert(!/[\r\n]/.test(subject), s);
  }
});

Deno.test("ctas", () => {
  const has = (s: NurtureStep, path: string) => mk(s).html.includes(`${BASE}${path}?utm_source=email`);
  assert(has("a1", "/clientes") && has("a1", "/importar") && has("a2", "/clientes"));
  for (const s of ["a3", "b1", "b2", "b3"] as const) assert(has(s, "/comecar"), s);
});

Deno.test("b2 empty/blank client name falls back; non-finite clientCount is 0", () => {
  for (const v of ["", "   "]) {
    const h = mk("b2", { firstClientName: v }).html;
    assert(!h.includes("para  um") && h.includes("para o seu cliente") && h.includes("Testar o Hub com meu cliente"));
  }
  assert(mk("b1", { clientCount: NaN }).subject === "Teste tudo do Mesaas por 30 dias");
});
