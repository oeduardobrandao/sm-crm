/**
 * Owner lifecycle e-mails in the workspace language. The pt half compares every
 * render with `fixtures/lifecycle-pt.json`, captured from the code before the
 * language change (inputs in `fixtures/lifecycle-cases.ts`).
 */
import { assert, assertEquals } from "./assert.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as C from "./fixtures/lifecycle-cases.ts";
import * as L from "../_shared/lifecycle-emails.ts";
import { buildNurtureEmail, nurtureSubject } from "../_shared/nurture-emails.ts";
import { createNurtureUnsubHandler } from "../nurture-unsub/handler.ts";
import { signNurtureUnsubToken } from "../_shared/nurture-unsub-token.ts";
import { runLifecycleEmailCron, runNurturePreview } from "../lifecycle-email-cron/handler.ts";
import type { LifecycleCronDeps } from "../lifecycle-email-cron/handler.ts";

const FIX = JSON.parse(await Deno.readTextFile(new URL("./fixtures/lifecycle-pt.json", import.meta.url))) as Record<string, any>;

const ACCENT = /[ãçõáéíóúâêôà—]/;

// --- pt unchanged -----------------------------------------------------------

Deno.test("pt unchanged: welcome", () => {
  for (const [k, v] of Object.entries(C.WELCOME_CASES)) {
    Deno.env.set("WHATSAPP_SUPPORT_NUMBER", v.wa ? "5511999999999" : "");
    const html = L.buildWelcomeEmail({ firstName: v.firstName, appBaseUrl: C.BASE, reverseTrialOffer: v.reverseTrialOffer, lang: "pt" });
    assertEquals(html, FIX[k], k);
  }
  Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
});

Deno.test("pt unchanged: thank-you, charge date, first charge", () => {
  assertEquals(L.buildThankYouEmail({ ...C.THANKS_INPUT, lang: "pt" }), FIX["thanks"]);
  assertEquals(L.buildThankYouEmail({ ...C.THANKS_ANON, lang: "pt" }), FIX["thanks-anon"]);
  assertEquals(L.formatChargeDate(C.CHARGE_DATE_ISO, "pt"), FIX["charge-date"]);
  assertEquals(L.formatChargeDate(C.CHARGE_DATE_ISO), FIX["charge-date"]);
  for (const [k, v] of Object.entries(C.FIRST_CHARGE_CASES)) {
    assertEquals(L.formatFirstCharge(v, "pt"), FIX[k], k);
    assertEquals(L.formatFirstCharge(v), FIX[k], k);
  }
});

Deno.test("pt unchanged: trial reminder and reverse trial", () => {
  for (const [k, v] of Object.entries(C.REMINDER_CASES)) {
    assertEquals(L.buildTrialReminderEmail({ ...v, lang: "pt" }), FIX[k], k);
  }
  for (const [k, v] of Object.entries(C.REVERSE_CASES)) {
    assertEquals(L.buildReverseTrialEmail({ ...v, lang: "pt" }), FIX[k], k);
  }
});

Deno.test("pt locked: confirm reminders", () => {
  for (const [k, v] of Object.entries(C.CONFIRM_CASES)) {
    const r = L.buildConfirmReminderEmail({ ...v, lang: "pt" });
    assertEquals(r.html, FIX[k], k);
  }
});

Deno.test("pt unchanged: every nurture variant", () => {
  for (const [k, v] of Object.entries(C.NURTURE_CASES)) {
    assertEquals(buildNurtureEmail({ ...v, lang: "pt" }), FIX[k], k);
  }
});

Deno.test("pt unchanged: exported pt subjects and classifier helpers", () => {
  const f = FIX["subjects"];
  assertEquals(L.reverseTrialEndingSubject("3 de dezembro"), f.ending);
  assertEquals(L.trialReminderSubject("Pro", 7), f.reminder);
  assertEquals(L.WELCOME_SUBJECT, f.welcome);
  assertEquals(L.THANKYOU_SUBJECT, f.thanks);
  assertEquals(L.REVERSE_TRIAL_ENDED_SUBJECT, f.ended);
  assertEquals(L.REVERSE_TRIAL_HUB_PAUSING_SUBJECT, f.hub);
  assertEquals(L.WELCOME_REVERSE_TRIAL_LEAD, f.lead);
});

const SECRET = "s";
const UID = "123e4567-e89b-42d3-a456-426614174000";
function unsubHandler(error: { message: string } | null, ownerLang?: (id: string) => Promise<"pt" | "en">) {
  return createNurtureUnsubHandler({
    db: { from: () => ({ update: () => ({ eq: () => ({ is: () => Promise.resolve({ error }) }) }) }) } as never,
    tokenSecret: SECRET,
    now: () => new Date("2026-11-06T12:00:00Z"),
    buildCorsHeaders: () => ({}),
    ownerLang,
  });
}
const ureq = (m: string, t: string) => new Request(`https://x/functions/v1/nurture-unsub/${t}`, { method: m });

Deno.test("pt unchanged: unsubscribe pages (no lookup wired)", async () => {
  const tok = await signNurtureUnsubToken(UID, SECRET);
  assertEquals(await (await unsubHandler(null)(ureq("GET", tok))).text(), FIX["unsub-confirm"]);
  assertEquals(await (await unsubHandler(null)(ureq("POST", tok))).text(), FIX["unsub-done"]);
  assertEquals(await (await unsubHandler(null)(ureq("GET", "bad"))).text(), FIX["unsub-invalid"]);
  assertEquals(await (await unsubHandler({ message: "x" })(ureq("POST", tok))).text(), FIX["unsub-error"]);
});

Deno.test("legacy token renders pt page for a pt owner", async () => {
  const tok = await signNurtureUnsubToken(UID, SECRET);
  const res = await unsubHandler(null, () => Promise.resolve("pt"))(ureq("GET", tok));
  assertEquals(await res.text(), FIX["unsub-confirm"]);
});

// --- en ---------------------------------------------------------------------

Deno.test("en welcome: lang, body phrase, signature", () => {
  Deno.env.set("WHATSAPP_SUPPORT_NUMBER", "5511999999999");
  const html = L.buildWelcomeEmail({ firstName: "Ana", appBaseUrl: C.BASE, lang: "en" });
  Deno.env.delete("WHATSAPP_SUPPORT_NUMBER");
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "Hi, Ana! So glad you&#39;re here.");
  assertStringIncludes(html, "Founder of Mesaas");
  assertStringIncludes(html, "Chat on WhatsApp");
  assertStringIncludes(html, "text=Hi!%20I&#39;m%20Ana.");
  assert(!ACCENT.test(html.replace(/👋/g, "")), "no accented chars in en welcome");
});

Deno.test("en thank-you escapes the workspace name", () => {
  const html = L.buildThankYouEmail({ ...C.THANKS_INPUT, lang: "en" });
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "just activated a plan");
  assertStringIncludes(html, "&lt;Aurora&gt;");
});

Deno.test("en first charge and dates", () => {
  assertEquals(L.formatChargeDate(C.CHARGE_DATE_ISO, "en"), "December 2");
  assertEquals(L.formatFirstCharge(C.FIRST_CHARGE_CASES["fc-stripe-month-usd"], "en"), "$29.00 per month");
  assertEquals(L.formatFirstCharge(C.FIRST_CHARGE_CASES["fc-stripe-year-usd"], "en"), "$1,299.00 per year");
  assertEquals(
    L.formatFirstCharge(C.FIRST_CHARGE_CASES["fc-pagarme"], "en"),
    "12 installments of R$99.17 (total R$1,190.00)",
  );
  assertEquals(L.formatFirstCharge(C.FIRST_CHARGE_CASES["fc-none"], "en"), null);
});

Deno.test("en trial reminder", () => {
  const { subject, html } = L.buildTrialReminderEmail({ ...C.REMINDER_CASES["reminder-full"], firstChargeDate: "December 3", firstCharge: "$29.00 per month", lang: "en" });
  assertEquals(subject, "Your Mesaas Pro trial ends in 7 days");
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "On that day we make the first charge of $29.00 per month");
  assertStringIncludes(html, "Plan &amp; Billing");
});

Deno.test("en reverse trial emails", () => {
  const ending = L.buildReverseTrialEmail({ ...C.REVERSE_CASES["rt-ending-usd"], lang: "en" });
  assertEquals(ending.subject, "Your Pro trial ends on December 3");
  assertStringIncludes(ending.html, '<html lang="en"');
  assertStringIncludes(ending.html, "$29.00 per month");
  const ended = L.buildReverseTrialEmail({ ...C.REVERSE_CASES["rt-ended-pause"], lang: "en" });
  assertEquals(ended.subject, "Your workspace went back to the Free plan");
  assertStringIncludes(ended.html, "Nothing was deleted");
  assertStringIncludes(ended.html, "pause on December 10");
  const hub = L.buildReverseTrialEmail({ ...C.REVERSE_CASES["rt-hub"], lang: "en" });
  assertEquals(hub.subject, "Your clients' portal links pause tomorrow");
  assertStringIncludes(hub.html, "Tomorrow, December 10");
});

Deno.test("en nurture: every step has an en subject, html lang and no pt leakage", () => {
  for (const [k, v] of Object.entries(C.NURTURE_CASES)) {
    const { subject, html } = buildNurtureEmail({ ...v, lang: "en" });
    assertStringIncludes(html, '<html lang="en"', k);
    assertStringIncludes(html, "Unsubscribe", k);
    assert(!ACCENT.test(subject), `${k} subject: ${subject}`);
    assert(subject !== FIX[k].subject, `${k} subject still pt`);
    assert(!/Cadastr|Recuper|teste gr|Você|Oi,/.test(html.replace(/Studio Bela|Agência Aurora/g, "")), `${k} leaks pt`);
  }
  assertEquals(nurtureSubject("a1", { clientCount: 0 }, "en"), "Your first client on Mesaas takes 3 minutes");
  assertEquals(
    nurtureSubject("b1", { clientCount: 1 }, "en"),
    "You already have 1 client on Mesaas. Try the rest free for 30 days",
  );
});

Deno.test("en unsubscribe pages follow the owner language", async () => {
  const tok = await signNurtureUnsubToken(UID, SECRET);
  const en = () => Promise.resolve("en" as const);
  const confirm = await (await unsubHandler(null, en)(ureq("GET", tok))).text();
  assertStringIncludes(confirm, '<html lang="en">');
  assertStringIncludes(confirm, "Stop receiving Mesaas tips?");
  const done = await (await unsubHandler(null, en)(ureq("POST", tok))).text();
  assertStringIncludes(done, "Settings &gt; Notifications");
  const err = await (await unsubHandler({ message: "x" }, en)(ureq("POST", tok))).text();
  assertStringIncludes(err, "Something went wrong");
  // a failing lookup reads pt and still answers
  const boom = await (await unsubHandler(null, () => Promise.reject(new Error("db")))(ureq("GET", tok))).text();
  assertEquals(boom, FIX["unsub-confirm"]);
});

// --- cron wiring ------------------------------------------------------------

function cronDeps(over: Partial<LifecycleCronDeps>, sent: any[]): LifecycleCronDeps {
  const rows: Record<string, unknown[]> = {
    get_welcome_email_candidates: [
      { user_id: "u1", email: "a@x.com", nome: "Ana", attempts: 0 },
      { user_id: "u2", email: "b@x.com", nome: "Bia", attempts: 0 },
      { user_id: "u2", email: "b@x.com", nome: "Bia", attempts: 0 },
    ],
    get_thankyou_email_candidates: [],
    get_trial_reminder_candidates: [],
    get_reverse_trial_email_candidates: [],
    get_nurture_candidates: [],
  };
  return {
    db: {
      rpc: (name: string) => Promise.resolve({ data: rows[name] ?? [], error: null }),
      from: () => ({
        upsert: () => Promise.resolve({ error: null }),
        update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
      }),
    } as unknown as LifecycleCronDeps["db"],
    appBaseUrl: C.BASE,
    now: () => new Date("2026-11-26T12:00:00Z"),
    sendWelcome: (p) => {
      sent.push(p);
      return Promise.resolve();
    },
    sendThanks: () => Promise.resolve(),
    sendFounderSignup: () => Promise.resolve(),
    sendFounderSubscription: () => Promise.resolve(),
    sendTrialReminder: () => Promise.resolve(),
    sendReverseTrial: () => Promise.resolve(),
    nurtureEnabled: false,
    nurtureUnsubLinks: () => Promise.resolve({ page: C.UNSUB, oneClick: C.UNSUB }),
    whatsappUrl: null,
    sendNurture: () => Promise.resolve(),
    report: () => Promise.resolve(),
    ...over,
  };
}

Deno.test("cron passes the owner language to the welcome sender, caching per owner", async () => {
  const sent: any[] = [];
  const calls: string[] = [];
  const deps = cronDeps({
    lang: {
      owner: (id) => {
        calls.push(id);
        return Promise.resolve(id === "u2" ? "en" : "pt");
      },
      workspace: () => Promise.resolve("pt"),
    },
  }, sent);
  await runLifecycleEmailCron(deps);
  assertEquals(sent.map((s) => s.lang), ["pt", "en", "en"]);
  assertEquals(calls, ["u1", "u2"]);
});

Deno.test("cron without a lang dep, or with a throwing one, sends pt", async () => {
  const sent: any[] = [];
  await runLifecycleEmailCron(cronDeps({}, sent));
  assertEquals(sent.map((s) => s.lang), ["pt", "pt", "pt"]);
  const sent2: any[] = [];
  await runLifecycleEmailCron(cronDeps({
    lang: { owner: () => Promise.reject(new Error("db")), workspace: () => Promise.reject(new Error("db")) },
  }, sent2));
  assertEquals(sent2.map((s) => s.lang), ["pt", "pt", "pt"]);
});

Deno.test("nurture and reverse trial use the owner language, not the candidate workspace", async () => {
  const nurture: any[] = [];
  const reverse: any[] = [];
  const deps = cronDeps({
    nurtureEnabled: true,
    lang: { owner: () => Promise.resolve("en"), workspace: () => Promise.resolve("pt") },
    sendNurture: (p) => (nurture.push(p), Promise.resolve()),
    sendReverseTrial: (p) => (reverse.push(p), Promise.resolve()),
  }, []);
  const rpc = deps.db.rpc.bind(deps.db);
  deps.db = {
    ...deps.db,
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (name === "get_nurture_candidates") {
        return Promise.resolve({
          data: [{
            user_id: "u1", workspace_id: "w1", email: "a@x.com", nome: "Ana", workspace_name: "Aurora",
            workspace_created_at: "2026-11-01", email_type: "nurture_a1", step: "a1", attempts: 0,
            client_count: 0, first_client_name: null, has_instagram: false,
          }],
          error: null,
        });
      }
      if (name === "claim_nurture_email") return Promise.resolve({ data: { ok: true }, error: null });
      if (name === "get_reverse_trial_email_candidates") {
        return Promise.resolve({
          data: [{
            workspace_id: "w1", user_id: "u1", email: "a@x.com", nome: "Ana", workspace_name: "Aurora",
            email_type: "reverse_trial_hub_pausing", ref_at: "2026-12-10T15:00:00Z", ends_at: null,
            ended_at: null, hub_pause_at: "2026-12-10T15:00:00Z", plan_name: "Pro", price_cents: null, attempts: 0,
          }],
          error: null,
        });
      }
      return rpc(name, args);
    },
  } as LifecycleCronDeps["db"];
  await runLifecycleEmailCron(deps);
  assertEquals(nurture.length, 1);
  assertStringIncludes(nurture[0].html, '<html lang="en"');
  assertEquals(reverse.length, 1);
  assertStringIncludes(reverse[0].html, '<html lang="en"');
  assertEquals(reverse[0].subject, "Your clients' portal links pause tomorrow");
});

Deno.test("nurture preview defaults to pt and can preview en", async () => {
  const out: any[] = [];
  const deps = cronDeps({ sendNurture: (p) => (out.push(p), Promise.resolve()) }, []);
  await runNurturePreview(deps, "x@y.com");
  assertStringIncludes(out[0].html, '<html lang="pt-BR"');
  assert(!out[0].idempotencyKey.endsWith("/en"));
  const out2: any[] = [];
  const deps2 = cronDeps({ sendNurture: (p) => (out2.push(p), Promise.resolve()) }, []);
  await runNurturePreview(deps2, "x@y.com", "en");
  assertStringIncludes(out2[0].html, '<html lang="en"');
  assert(out2[0].idempotencyKey.endsWith("/en"));
  assertEquals(out2[0].tags.type, "nurture_a1");
});
