import { assert, assertEquals } from "./assert.ts";
import { newImageKeys, normalizePopupTrigger, validatePopupFields } from "../_shared/admin-popups.ts";

Deno.test("newImageKeys: retorna chaves novas sem duplicatas, ignora persistidas e input não-array", () => {
  const persisted = new Set(["contas/c1/files/a.png"]);
  const pages = [
    { image_key: "contas/c1/files/a.png" }, // já persistida: fora
    { image_key: "contas/c1/files/b.png" }, // nova
    { image_key: "contas/c1/files/b.png" }, // repetida: não duplica
    { image_key: "" }, // vazia: fora
    {}, // sem image_key: fora
  ];
  assertEquals(newImageKeys(pages, persisted), ["contas/c1/files/b.png"]);
  assertEquals(newImageKeys("not-an-array", persisted), []);
  assertEquals(newImageKeys(undefined, persisted), []);
});

const BASE = {
  cta_label: null, cta_url: null, secondary_label: null,
  frequency: "once", require_ack: false, target_mode: "all",
};

Deno.test("validatePopupFields: gatilho (enum ou nulo) e trigger_days só com trial_ending, 1..60 inteiro", () => {
  assertEquals(validatePopupFields({ ...BASE, trigger: null }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "payment_pending" }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "plan_downgraded" }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 3 }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 1 }), null);
  assertEquals(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 60 }), null);
  assert(validatePopupFields({ ...BASE, trigger: "bogus" }) !== null, "trigger inválido");
  assert(validatePopupFields({ ...BASE, trigger: "" }) !== null, "trigger vazio sem normalizar");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending" }) !== null, "trial_ending sem dias");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: null }) !== null, "trial_ending com dias null");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 0 }) !== null, "0 dias");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 61 }) !== null, "61 dias");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: 2.5 }) !== null, "dias fracionário");
  assert(validatePopupFields({ ...BASE, trigger: "trial_ending", trigger_days: "3" }) !== null, "dias como string");
  assert(validatePopupFields({ ...BASE, trigger: "payment_pending", trigger_days: 3 }) !== null, "dias fora de trial_ending");
  assert(validatePopupFields({ ...BASE, trigger_days: 3 }) !== null, "dias sem gatilho");
});

Deno.test("validatePopupFields: frequency daily, com e sem require_ack; until_cta + require_ack segue proibido", () => {
  assertEquals(validatePopupFields({ ...BASE, frequency: "daily" }), null);
  assertEquals(validatePopupFields({ ...BASE, frequency: "daily", require_ack: true }), null);
  assert(
    validatePopupFields({ ...BASE, frequency: "until_cta", cta_label: "Ver", cta_url: "/x", require_ack: true }) !== null,
    "require_ack + until_cta",
  );
});

Deno.test("normalizePopupTrigger: decide sobre a linha mesclada e só zera dias que vieram da linha atual", () => {
  // create (sem current): "" vira null; dias enviados no patch ficam para a validação rejeitar
  assertEquals(normalizePopupTrigger({ trigger: "" }), { trigger: null });
  assertEquals(normalizePopupTrigger({ trigger: "trial_ending", trigger_days: 3 }), { trigger: "trial_ending", trigger_days: 3 });
  assertEquals(normalizePopupTrigger({ trigger: "payment_pending", trigger_days: 3 }), { trigger: "payment_pending", trigger_days: 3 });
  assertEquals(normalizePopupTrigger({ trigger_days: 5 }), { trigger_days: 5 });
  assertEquals(normalizePopupTrigger({ cta_label: "x" }), { cta_label: "x" });
  assertEquals(normalizePopupTrigger({}), {});
  // update: patch que nao toca no gatilho sai intacto (senao a CHECK derruba a edicao)
  const current = { id: "p1", trigger: "trial_ending", trigger_days: 5 };
  assertEquals(normalizePopupTrigger({ cta_label: "novo" }, current), { cta_label: "novo" });
  assertEquals(normalizePopupTrigger({ status: "active" }, current), { status: "active" });
  // update: troca de gatilho sem mandar dias zera os dias PERSISTIDOS
  assertEquals(normalizePopupTrigger({ trigger: "payment_pending" }, current), { trigger: "payment_pending", trigger_days: null });
  assertEquals(normalizePopupTrigger({ trigger: null }, current), { trigger: null, trigger_days: null });
  assertEquals(normalizePopupTrigger({ trigger: "" }, current), { trigger: null, trigger_days: null });
  // update: dias novos com trial_ending mantido passam
  assertEquals(normalizePopupTrigger({ trigger_days: 7 }, current), { trigger_days: 7 });
  // update: dias ENVIADOS no patch sem trial_ending nao sao apagados (a validacao rejeita)
  assertEquals(
    normalizePopupTrigger({ trigger_days: 7 }, { trigger: "payment_pending", trigger_days: null }),
    { trigger_days: 7 },
  );
  assertEquals(
    normalizePopupTrigger({ trigger: "payment_pending", trigger_days: 7 }, current),
    { trigger: "payment_pending", trigger_days: 7 },
  );
  // update em popup sem gatilho: nada a emitir
  assertEquals(normalizePopupTrigger({ cta_label: "x" }, { trigger: null, trigger_days: null }), { cta_label: "x" });
});

Deno.test("normalizePopupTrigger + validatePopupFields: dias no patch sem trial_ending viram erro, não coerção silenciosa", () => {
  assert(validatePopupFields({ ...BASE, ...normalizePopupTrigger({ trigger_days: 5 }) }) !== null, "dias sem gatilho no create");
  assert(
    validatePopupFields({ ...BASE, ...normalizePopupTrigger({ trigger: "payment_pending", trigger_days: 5 }) }) !== null,
    "dias com payment_pending no create",
  );
  const current = { ...BASE, trigger: "trial_ending", trigger_days: 5 };
  assertEquals(validatePopupFields({ ...current, ...normalizePopupTrigger({ trigger: "payment_pending" }, current) }), null);
  assert(
    validatePopupFields({ ...current, ...normalizePopupTrigger({ trigger_days: null }, current) }) !== null,
    "apagar dias mantendo trial_ending",
  );
  const paying = { ...BASE, trigger: "payment_pending", trigger_days: null };
  assert(validatePopupFields({ ...paying, ...normalizePopupTrigger({ trigger_days: 7 }, paying) }) !== null, "dias num popup payment_pending");
});
