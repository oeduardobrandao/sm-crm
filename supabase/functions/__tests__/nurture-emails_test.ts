import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildNurtureEmail,
  NURTURE_SAMPLE,
  type NurtureEmailInput,
  type NurtureStep,
  nurtureTagType,
  nurtureUtm,
  nurtureWorkspaceName,
} from "../_shared/nurture-emails.ts";

const STEPS: NurtureStep[] = ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"];
const BASE = "https://app.example.com";
const UNSUB = "https://fn.example.com/unsub?t=abc&x=1";
const WA = "https://wa.me/5500000000000";

const mk = (step: NurtureStep, o: Partial<NurtureEmailInput> = {}) =>
  buildNurtureEmail({ ...NURTURE_SAMPLE, step, appBaseUrl: BASE, unsubUrl: UNSUB, whatsappUrl: WA, ...o });

Deno.test("nurtureUtm builds the tracked url", () => {
  assert(nurtureUtm(BASE, "/clientes", "a1") === `${BASE}/clientes?utm_source=email&utm_medium=nurture&utm_campaign=nurture_a1`);
  assert(nurtureUtm(`${BASE}/`, "/clientes", "a1") === nurtureUtm(BASE, "/clientes", "a1"));
  assert(nurtureUtm(`${BASE}///`, "/comecar", "b1").startsWith(`${BASE}/comecar?`));
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
  assert(mk("b1", { firstName: null }).html.includes("Agência Aurora já está no Mesaas."));
  assert(mk("b1").html.includes("Ana, Agência Aurora já está no Mesaas."));
});

Deno.test("b2 names first client or falls back", () => {
  const named = mk("b2", { firstClientName: "Studio Bela" });
  assert(named.html.includes("com os posts da semana, para o seu cliente Studio Bela. Ele abre no celular"));
  assert(named.html.includes("Studio Bela pode aprovar a semana inteira num link."));
  assert(named.html.includes("Testar o Hub com meu cliente"));
  const generic = mk("b2", { firstClientName: null });
  assert(!generic.html.includes("null") && !generic.html.includes("Studio Bela"));
  assert(generic.html.includes("com os posts da semana, para o seu cliente. Ele abre no celular"));
  assert(generic.html.includes("Seu cliente pode aprovar a semana inteira num link."));
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
  const b4 = mk("b4", { workspaceName: "Zeta" }).html;
  assert(b4.includes("Vi que você já usa o Mesaas com seus clientes") && !b4.includes("Zeta"));
});

Deno.test("user data is escaped", () => {
  const o = { firstName: "<img src=x onerror=alert(1)>", workspaceName: "Aurora\r\nBcc: x", firstClientName: '"><script>' };
  for (const s of STEPS) {
    const { subject, html } = mk(s, o);
    assert(!html.includes("<img src=x") && !html.includes("<script>"), s);
    // the steps that print a user value print it escaped
    if (s === "a3" || s === "b1" || s === "b2") assert(html.includes("&lt;"), `${s} escaped`);
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
    assert(!h.includes("cliente  ") && h.includes("para o seu cliente. Ele abre") && h.includes("Testar o Hub com meu cliente"));
  }
  assert(mk("b1", { clientCount: NaN }).subject === "Teste tudo do Mesaas por 30 dias");
});

Deno.test("no gendered article before user names; default workspace name falls back", () => {
  assert(nurtureWorkspaceName("Meu Workspace") === null);
  assert(nurtureWorkspaceName("  meu workspace ") === null);
  assert(nurtureWorkspaceName("   ") === null);
  assert(nurtureWorkspaceName(" Zeta ") === "Zeta");

  const def = mk("b1", { workspaceName: "Meu Workspace" }).html;
  assert(def.includes("Ana, sua agência já está no Mesaas.") && !def.includes("Meu Workspace"));
  assert(mk("b1", { workspaceName: "  meu workspace  ", firstName: null }).html.includes("Sua agência já está no Mesaas."));
  assert(mk("b1", { workspaceName: "" }).html.includes("Ana, sua agência já está no Mesaas."));

  // masculine and feminine names for every user string
  const cases = [
    { firstName: "Pedro", workspaceName: "Estúdio Norte", firstClientName: "João Pedro" },
    { firstName: "Mariana", workspaceName: "Agência Lua", firstClientName: "Clínica Bela" },
    { firstName: "Ana", workspaceName: "Meu Workspace", firstClientName: "Dra. Marina" },
  ];
  for (const o of cases) {
    for (const s of STEPS) {
      const { subject, html } = mk(s, o);
      const text = `${subject} ${html}`;
      for (const name of [o.firstName, o.workspaceName, o.firstClientName]) {
        assert(!text.includes(` o ${name}`) && !text.includes(` a ${name}`), `${s} article before ${name}`);
        assert(!text.includes(`>O ${name}`) && !text.includes(`>A ${name}`), `${s} capital article before ${name}`);
      }
      assert(!text.includes("a Meu Workspace") && !text.includes("A Meu Workspace"), `${s} a Meu Workspace`);
    }
  }
});

Deno.test("feature screenshots: one per tip/trial email, none on the last-ask emails", () => {
  const expected: Record<NurtureStep, string | null> = {
    a1: "nurture-clientes.jpg",
    a2: "nurture-aprovacoes.jpg",
    a3: "nurture-hub.jpg",
    a4: null,
    b1: "nurture-hub.jpg",
    b2: "nurture-aprovar.jpg",
    b3: "nurture-relatorios.jpg",
    b4: null,
  };
  for (const [step, file] of Object.entries(expected) as [NurtureStep, string | null][]) {
    const { html } = buildNurtureEmail({ ...NURTURE_SAMPLE, step, appBaseUrl: BASE, unsubUrl: UNSUB, whatsappUrl: WA });
    const shots = [...html.matchAll(/src="https:\/\/www\.mesaas\.com\.br\/email\/([^"]+)"/g)].map((m) => m[1]);
    assert(file ? shots.length === 1 && shots[0] === file : shots.length === 0, `${step}: ${shots.join(",")}`);
    if (file) assert(/alt="[^"]{10,}"/.test(html.slice(html.indexOf(file))), `${step}: alt text`);
  }
});

// ─── Teste reverso (Task 10) ────────────────────────────────────────────────

const EX_STEPS: NurtureStep[] = ["a3", "b1", "b2", "b3"];
const RECOVER_HREF = `href="${BASE}/comecar?recomendado=pro&amp;utm_source=email`;

function assertRecoverCopy(step: NurtureStep, o: Partial<NurtureEmailInput> = {}) {
  const { subject, html } = mk(step, { exReverseTrial: true, ...o });
  const text = `${subject} ${html}`;
  assert(!/grátis/i.test(text), `${step}: no "grátis" for an ex-trial owner`);
  assert(!text.includes("30 dias"), `${step}: no 30-day trial`);
  assert(!text.includes("O teste pede um cartão"), `${step}: no card-trial fine print`);
  assert(html.includes("Recuperar o Pro"), `${step}: CTA`);
  assert(html.includes(RECOVER_HREF), `${step}: link to /comecar?recomendado=pro with utm`);
  assert(!/href="[^"]*\/comecar\?utm/.test(html), `${step}: no plain /comecar trial link`);
  assert(html.includes("a primeira cobrança é feita ao assinar"), `${step}: immediate-charge framing`);
  assert(html.includes("Descadastrar</a>."), `${step}: unsub footer`);
  assert(!text.includes("—"), `${step}: em dash`);
  return { subject, html };
}

Deno.test("nurtureUtm appends with & when the path already has a query", () => {
  assert(
    nurtureUtm(BASE, "/comecar?recomendado=pro", "b1") ===
      `${BASE}/comecar?recomendado=pro&utm_source=email&utm_medium=nurture&utm_campaign=nurture_b1`,
  );
});

Deno.test("nurture_a3_ex_trial_variant: ex-trial a3 offers the Pro back, not a free trial", () => {
  const { subject, html } = assertRecoverCopy("a3");
  assert(subject === "Recupere o Pro no Mesaas", subject);
  assert(html.includes("teste de 14 dias do Pro terminou"));
  assert(html.includes("Nada foi apagado"));
});

Deno.test("nurture_b_ex_trial_no_free_trial_copy: b1, b2 and b3 never pitch a free trial to an ex-trial owner", () => {
  for (const step of ["b1", "b2", "b3"] as NurtureStep[]) {
    for (const o of [{ clientCount: 0 }, { clientCount: 1 }, { clientCount: 4, hasInstagram: true }]) {
      assertRecoverCopy(step, o);
    }
  }
});

Deno.test("nurture b1 ex-trial: own subject and the Free limit line at 2+ clients", () => {
  const atLimit = assertRecoverCopy("b1", { clientCount: 3 });
  assert(atLimit.subject === "Recupere o Pro para a sua agência", atLimit.subject);
  assert(atLimit.html.includes("Você já cadastrou 3 clientes, e esse é o limite do plano Free."));
  assert(atLimit.html.includes("Seu Free parou em 2 clientes. O Pro libera o resto."));
  const one = assertRecoverCopy("b1", { clientCount: 1 });
  assert(one.html.includes("Você já cadastrou seu primeiro cliente. Com o Pro de volta"));
});

Deno.test("nurture b2 ex-trial: Hub, equipe e Instagram são do Pro", () => {
  const { subject, html } = assertRecoverCopy("b2");
  assert(subject === "Seu cliente aprova o post pelo celular", subject);
  assert(html.includes("fazem parte do Pro."));
});

Deno.test("nurture b3 ex-trial: report line says Pro, not the trial", () => {
  const { html } = assertRecoverCopy("b3", { hasInstagram: true });
  assert(html.includes("No Pro, o relatório em PDF"));
  assert(!html.includes("No teste,"));
});

Deno.test("nurture: exReverseTrial changes only a3, b1, b2 and b3", () => {
  for (const s of STEPS) {
    const plain = mk(s);
    const ex = mk(s, { exReverseTrial: true });
    const same = plain.subject === ex.subject && plain.html === ex.html;
    assert(EX_STEPS.includes(s) ? !same : same, s);
  }
  assert(mk("a3").subject === "Teste tudo do Mesaas por 30 dias");
  assert(mk("b1").html.includes("Começar meu teste grátis"), "non-ex b1 unchanged");
});

Deno.test("nurtureTagType: _ex_trial suffix only on the four variant steps", () => {
  for (const s of STEPS) {
    assert(nurtureTagType(s, false) === `nurture_${s}`, s);
    assert(nurtureTagType(s, null) === `nurture_${s}`, s);
    assert(nurtureTagType(s, true) === (EX_STEPS.includes(s) ? `nurture_${s}_ex_trial` : `nurture_${s}`), s);
  }
});
