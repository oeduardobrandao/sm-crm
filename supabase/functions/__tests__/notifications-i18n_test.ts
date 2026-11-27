/**
 * Team notifications (digest email, iOS push) in the workspace language. The pt
 * half compares every render with `fixtures/notifications-pt.json`, captured
 * from the code before the language change (inputs in
 * `fixtures/notifications-cases.ts`).
 */
import { assert, assertEquals } from "./assert.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as C from "./fixtures/notifications-cases.ts";
import { majorityLang, renderNotification } from "../_shared/notification-render.ts";
import { buildDigestHtml, digestPreheader, digestSubject, resolveDigestItem } from "../_shared/notification-email.ts";
import { buildPushMessage, type ClaimedPushRow, runNotificationPushCron } from "../notification-push-cron/handler.ts";
import type { NotificationPushCronDeps, NotificationPushDb } from "../notification-push-cron/handler.ts";
import { runNotificationEmailCron } from "../notification-email-cron/handler.ts";
import type { ClaimedNotificationRow, NotificationEmailCronDeps, NotificationEmailDb } from "../notification-email-cron/handler.ts";

const FIX = JSON.parse(await Deno.readTextFile(new URL("./fixtures/notifications-pt.json", import.meta.url))) as Record<string, unknown>;
const json = (v: unknown) => JSON.parse(JSON.stringify(v));
const ACCENT = /[ãçõáéíóúâêôà—]/;

// --- pt unchanged -----------------------------------------------------------

Deno.test("pt unchanged: renderNotification and resolveDigestItem for every case", () => {
  for (const [k, row] of Object.entries(C.RENDER_CASES)) {
    assertEquals(json(renderNotification(row, "pt")), FIX[`render/${k}`], k);
    assertEquals(json(resolveDigestItem(row, "pt")), FIX[`item/${k}`], k);
  }
});

Deno.test("pt unchanged: digest subject, preheader and html", () => {
  for (const n of C.DIGEST_SIZES) {
    const items = C.ITEMS(n);
    assertEquals(digestSubject(items, "pt"), FIX[`digest/${n}/subject`], `subject ${n}`);
    assertEquals(digestPreheader(items, "pt"), FIX[`digest/${n}/preheader`], `preheader ${n}`);
    assertEquals(buildDigestHtml(items, C.BASE, "pt"), FIX[`digest/${n}/html`], `html ${n}`);
  }
});

Deno.test("pt unchanged: push messages", () => {
  for (const [k, rows] of Object.entries(C.PUSH_CASES)) {
    assertEquals(json(buildPushMessage(rows as unknown as ClaimedPushRow[], 3, "pt")), FIX[`push/${k}`], k);
  }
});

Deno.test("undefined or unknown lang renders pt", () => {
  const row = C.RENDER_CASES["mention/full"];
  assertEquals(renderNotification(row, undefined as never), renderNotification(row, "pt"));
  assertEquals(digestSubject(C.ITEMS(2), "fr" as never), FIX["digest/2/subject"]);
});

// --- en ----------------------------------------------------------------------

Deno.test("en: copy has no Portuguese accents for any case (user data made ASCII)", () => {
  const ascii = (v: unknown) => (typeof v === "string" && !/^\d{4}-/.test(v) && !["sim", "nao", "client", "removido", "solicitacao"].includes(v) && !/^[A-Z_]+$/.test(v) ? "x" : v);
  for (const [k, row] of Object.entries(C.RENDER_CASES)) {
    const meta = row.metadata ? Object.fromEntries(Object.entries(row.metadata).map(([a, v]) => [a, ascii(v)])) : null;
    const r = renderNotification({ ...row, metadata: meta }, "en");
    const i = resolveDigestItem({ ...row, metadata: meta }, "en");
    for (const v of [r.heading, r.body, r.context, i.badge?.label]) assert(!v || !ACCENT.test(v), `${k}: ${v}`);
  }
});

Deno.test("en: digest subject, preheader, body phrases and html lang", () => {
  const one = C.ITEMS(1);
  assertEquals(digestSubject(one, "en"), "T1 on Mesaas");
  assertEquals(digestSubject(C.ITEMS(4), "en"), "You have 4 new notifications on Mesaas");
  assertEquals(digestPreheader(C.ITEMS(3), "en"), "T1, T2 and T3.");
  assertEquals(digestPreheader(C.ITEMS(25), "en"), "T1, T2, T3 and 22 more.");
  const html = buildDigestHtml(C.ITEMS(2), C.BASE, "en");
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "You have 2 new notifications");
  assertStringIncludes(html, "Open in Mesaas");
  assertStringIncludes(html, "Notification digest");
  assertStringIncludes(buildDigestHtml(C.ITEMS(32), C.BASE, "en"), "And 2 more notifications.");
});

Deno.test("en: representative notification headings", () => {
  const h = (k: string) => renderNotification(C.RENDER_CASES[k], "en");
  assertEquals(h("post_correction/full").heading, "Client requested a correction");
  assertEquals(h("mention/full").heading, "Ana mentioned you");
  assertEquals(h("mention/null").heading, "Someone mentioned you");
  assertEquals(h("publish/TOKEN_EXPIRED").heading, "Instagram connection expired");
  assertEquals(h("publish/undefined").heading, "Publishing failed");
  assertEquals(h("event_reminder/2h").heading, "In 2 hours: Call");
  assertEquals(h("event_reminder/allday-1d").heading, "Tomorrow: Call");
  assertEquals(h("linha/dec").heading, "C requested changes to the editorial plan for December");
  assertEquals(h("linha/dec").body, "1 comment");
  assertEquals(h("something_unknown/null").heading, "New notification on Mesaas");
  assertEquals(resolveDigestItem(C.RENDER_CASES["post_correction/full"], "en").badge?.label, "Correction");
});

Deno.test("en: push grouped title and joiner", () => {
  const m = buildPushMessage(C.PUSH_CASES.five as unknown as ClaimedPushRow[], 1, "en");
  assertEquals(m.alert.title, "5 new notifications on Mesaas");
  assertStringIncludes(m.alert.body ?? "", " and 2 more.");
  const s = buildPushMessage(C.PUSH_CASES.single as unknown as ClaimedPushRow[], 1, "en");
  assertEquals(s.alert.title, "Ana mentioned you");
});

// --- language source ---------------------------------------------------------

Deno.test("majorityLang: majority wins, ties and empty are pt", () => {
  assertEquals(majorityLang(["en", "en", "pt"]), "en");
  assertEquals(majorityLang(["pt", "pt", "en"]), "pt");
  assertEquals(majorityLang(["en", "pt"]), "pt");
  assertEquals(majorityLang([]), "pt");
});

function emailDb(rows: ClaimedNotificationRow[]) {
  return {
    rpc: () => Promise.resolve({ data: rows, error: null }),
    from: () => ({ update: () => ({ in: () => Promise.resolve({ error: null }) }) }),
    auth: { admin: { getUserById: () => Promise.resolve({ data: { user: { email: "a@example.com" } }, error: null }) } },
  } as unknown as NotificationEmailDb;
}
const erow = (id: string, over: Partial<ClaimedNotificationRow> = {}): ClaimedNotificationRow => ({
  id, user_id: "u1", type: "mention", metadata: { actor_name: "Ana" }, link: "/x", created_at: "2026-08-13T11:00:00.000Z", ...over,
});

async function runEmail(rows: ClaimedNotificationRow[], langs: Record<string, "pt" | "en">, byRow: Record<string, string>, over: Partial<NotificationEmailCronDeps> = {}) {
  const sent: Array<{ subject: string; lang: string }> = [];
  const lookups: string[] = [];
  const deps: NotificationEmailCronDeps = {
    db: emailDb(rows),
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    resendEnabled: true,
    sendDigest: (p) => { sent.push({ subject: digestSubject(p.items, p.lang), lang: p.lang }); return Promise.resolve({ skipped: false }); },
    lang: {
      workspace: (id) => { lookups.push(id); return Promise.resolve(langs[id] ?? "pt"); },
      rowWorkspaces: (ids) => Promise.resolve(new Map(ids.filter((i) => byRow[i]).map((i) => [i, byRow[i]]))),
    },
    ...over,
  };
  await runNotificationEmailCron(deps);
  return { sent, lookups };
}

Deno.test("email cron: digest follows the workspace language of its rows", async () => {
  const { sent } = await runEmail([erow("n1")], { w1: "en" }, { n1: "w1" });
  assertEquals(sent[0].lang, "en");
  assertEquals(sent[0].subject, "Ana mentioned you on Mesaas");
});

Deno.test("email cron: mixed-workspace digest uses majority language", async () => {
  const rows = [erow("n1"), erow("n2"), erow("n3")];
  const byRow = { n1: "wEn", n2: "wEn", n3: "wPt" };
  const langs = { wEn: "en", wPt: "pt" } as const;
  const { sent, lookups } = await runEmail(rows, { ...langs }, byRow);
  assertEquals(sent[0].lang, "en");
  assertEquals(lookups.sort(), ["wEn", "wPt"], "one lookup per workspace");
  // tie: one en row, one pt row
  const tie = await runEmail([erow("n1"), erow("n2")], { ...langs }, { n1: "wEn", n2: "wPt" });
  assertEquals(tie.sent[0].lang, "pt");
});

Deno.test("email cron: row workspace_id is used when the claim returns it", async () => {
  const { sent } = await runEmail([erow("n1", { workspace_id: "w1" })], { w1: "en" }, {});
  assertEquals(sent[0].lang, "en");
});

Deno.test("email cron: lookup failure or missing deps falls back to pt and still sends", async () => {
  const failing = await runEmail([erow("n1")], {}, {}, {
    lang: { workspace: () => Promise.reject(new Error("x")), rowWorkspaces: () => Promise.reject(new Error("x")) },
  });
  assertEquals(failing.sent[0].lang, "pt");
  const failingWs = await runEmail([erow("n1")], {}, { n1: "w1" }, {
    lang: { workspace: () => Promise.reject(new Error("x")), rowWorkspaces: (ids) => Promise.resolve(new Map(ids.map((i) => [i, "w1"]))) },
  });
  assertEquals(failingWs.sent[0].lang, "pt");
  const none = await runEmail([erow("n1")], {}, {}, { lang: undefined });
  assertEquals(none.sent[0].lang, "pt");
});

function pushDb(rows: ClaimedPushRow[]) {
  return {
    rpc: (fn: string) => Promise.resolve(fn === "claim_notification_pushes" ? { data: rows, error: null } : { data: [], error: null }),
    from: (t: string) =>
      t === "push_devices"
        ? {
          select: () => ({ in: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [{ user_id: "u1", token: "tk", environment: "production" }], error: null }) }) }) }),
          update: () => ({ in: () => Promise.resolve({ error: null }) }),
        }
        : { update: () => ({ in: () => Promise.resolve({ error: null }) }) },
  } as unknown as NotificationPushDb;
}

async function runPush(rows: ClaimedPushRow[], wsLang?: NotificationPushCronDeps["workspaceLang"]) {
  const titles: string[] = [];
  await runNotificationPushCron({
    db: pushDb(rows),
    send: (_t, _e, m) => { titles.push(m.alert.title); return Promise.resolve({ ok: true } as never); },
    now: () => new Date("2026-10-15T12:00:00.000Z"),
    workspaceLang: wsLang,
  });
  return titles;
}

Deno.test("push cron: single push follows its workspace, summary follows the majority, failures are pt", async () => {
  const rows = C.PUSH_CASES;
  const single = rows.single.map((r) => ({ ...r, workspace_id: "wEn" })) as unknown as ClaimedPushRow[];
  assertEquals(await runPush(single, (id) => Promise.resolve(id === "wEn" ? "en" : "pt")), ["Ana mentioned you"]);
  assertEquals(await runPush(single), ["Ana mencionou você"]);
  assertEquals(await runPush(single, () => Promise.reject(new Error("x"))), ["Ana mencionou você"]);

  const mixed = rows.three.map((r, i) => ({ ...r, workspace_id: i < 2 ? "wEn" : "wPt" })) as unknown as ClaimedPushRow[];
  const lang = (id: string) => Promise.resolve(id === "wEn" ? "en" as const : "pt" as const);
  assertEquals(await runPush(mixed, lang), ["3 new notifications on Mesaas"]);
  const tie = rows.two.map((r, i) => ({ ...r, workspace_id: i === 0 ? "wEn" : "wPt" })) as unknown as ClaimedPushRow[];
  assertEquals(await runPush(tie, lang), ["2 novas notificações no Mesaas"]);
});
