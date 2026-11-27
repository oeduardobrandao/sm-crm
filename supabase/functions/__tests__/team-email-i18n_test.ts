/**
 * Team transactional e-mails (invite, dunning, Instagram connect, report-ready) in the
 * workspace language. The pt half compares every render with
 * `fixtures/team-email-pt.json`, captured from the code before the language change (inputs in
 * `fixtures/team-email-cases.ts`).
 */
import { assert, assertEquals } from "./assert.ts";
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as C from "./fixtures/team-email-cases.ts";
import { buildInviteEmail, inviteSubject } from "../_shared/invite-email.ts";
import { buildDunningCopy, buildDunningEmail } from "../_shared/dunning-email.ts";
import { formatAttemptLabel } from "../_shared/dunning-notify.ts";
import {
  buildConnectedNoticeEmail,
  buildConnectLinkEmail,
  CONNECT_LINK_SUBJECT,
  CONNECTED_NOTICE_SUBJECT,
  connectedNoticeSubject,
  connectLinkSubject,
} from "../_shared/instagram-connect-email.ts";
import { buildReportEmail, buildReportSubject } from "../_shared/report-template/email.ts";
import { fallbackLink } from "../_shared/email/blocks.ts";
import { workspaceLang } from "../_shared/i18n/workspace-lang.ts";

const FIX = JSON.parse(await Deno.readTextFile(new URL("./fixtures/team-email-pt.json", import.meta.url))) as Record<string, unknown>;
const ACCENT = /[ãçõáéíóúâêôà—]/;
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ");

// --- pt unchanged -----------------------------------------------------------

Deno.test("pt unchanged: invite e-mail and subject", () => {
  C.WS_NAMES.forEach((w, wi) => {
    C.INVITE_LINKS.forEach((l, li) =>
      assertEquals(buildInviteEmail({ actionLink: l, workspaceName: w, lang: "pt" }), FIX[`invite/${wi}/${li}/html`], `invite ${wi}/${li}`)
    );
    assertEquals(inviteSubject(w, "pt"), FIX[`invite/${wi}/subject`]);
  });
});

Deno.test("pt unchanged: dunning copy and html for every stage", () => {
  C.WS_NAMES.forEach((w, wi) => {
    for (const s of C.STAGES) {
      assertEquals(buildDunningCopy(s, w, null, "pt"), FIX[`dunning/${wi}/${s}/copy`], `copy ${wi}/${s}`);
      for (const n of C.NEXT_LABELS) {
        assertEquals(
          buildDunningEmail({ stage: s, workspaceName: w, nextAttemptLabel: n, billingUrl: `${C.APP}/c?a=1&b=2`, lang: "pt" }),
          FIX[`dunning/${wi}/${s}/${n}/html`],
          `html ${wi}/${s}/${n}`,
        );
      }
    }
  });
});

Deno.test("pt unchanged: dunning attempt label", () => {
  for (const i of C.ATTEMPT_ISOS) assertEquals(formatAttemptLabel(i, "pt"), FIX[`attempt/${i}`], String(i));
});

Deno.test("pt unchanged: instagram connect link and connected notice", () => {
  C.CONNECT_AGENCIES.forEach((a, i) => {
    assertEquals(connectLinkSubject(a, "pt"), FIX[`connect/${i}/subject`]);
    assertEquals(CONNECT_LINK_SUBJECT(a), FIX[`connect/${i}/subject`]);
    assertEquals(buildConnectLinkEmail({ agencyName: a, ...C.CONNECT, lang: "pt" }), FIX[`connect/${i}/html`], `connect ${i}`);
  });
  assertEquals(connectedNoticeSubject("pt"), FIX["connected/subject"]);
  assertEquals(CONNECTED_NOTICE_SUBJECT, FIX["connected/subject"]);
  assertEquals(buildConnectedNoticeEmail({ ...C.CONNECTED, lang: "pt" }), FIX["connected/html"]);
  assertEquals(buildConnectedNoticeEmail({ ...C.CONNECTED, igUsername: "", lang: "pt" }), FIX["connected/html-empty-ig"]);
});

Deno.test("pt unchanged: report e-mail html and subject for every month", () => {
  for (const [k, o] of Object.entries(C.REPORT_CASES)) {
    assertEquals(buildReportEmail({ ...C.REPORT_BASE, ...o, lang: "pt" } as never), FIX[`report/${k}`], k);
  }
  for (const m of C.MONTHS) assertEquals(buildReportSubject(m, "pt"), FIX[`report-subject/${m}`], m);
});

Deno.test("undefined or unknown lang renders pt", () => {
  assertEquals(
    buildInviteEmail({ actionLink: C.INVITE_LINKS[0], workspaceName: C.WS_NAMES[0], lang: undefined as never }),
    FIX["invite/0/0/html"],
  );
  assertEquals(inviteSubject("X", "fr" as never), "Seu acesso ao X no Mesaas");
  assertEquals(buildDunningCopy("first", "W", null, undefined as never), buildDunningCopy("first", "W", null, "pt"));
  assertEquals(buildReportSubject("2026-09", "fr" as never), FIX["report-subject/2026-09"]);
});

// --- en ----------------------------------------------------------------------

Deno.test("en: invite", () => {
  const html = buildInviteEmail({ actionLink: C.INVITE_LINKS[0], workspaceName: "Lume Agency", lang: "en" });
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "You have been invited to Lume Agency");
  assertStringIncludes(html, "Set my password");
  assertStringIncludes(html, "If the button does not work");
  assertEquals(inviteSubject("Lume Agency", "en"), "Your access to Lume Agency on Mesaas");
  assert(!ACCENT.test(textOf(html)));
});

Deno.test("en: dunning copy and email", () => {
  assertEquals(buildDunningCopy("first", "Lume", null, "en").subject, "We could not process your payment: Lume");
  assertEquals(buildDunningCopy("final", "Lume", null, "en").subject, "Final notice: access to Lume will be reduced");
  for (const s of C.STAGES) {
    const html = buildDunningEmail({ stage: s, workspaceName: "Lume", nextAttemptLabel: s === "final" ? null : "July 24", billingUrl: `${C.APP}/c`, lang: "en" });
    assertStringIncludes(html, '<html lang="en"');
    assertStringIncludes(html, "Subscription");
    assert(!ACCENT.test(textOf(html)), s);
  }
  const retry = buildDunningEmail({ stage: "retry", workspaceName: "Lume", nextAttemptLabel: "July 24", billingUrl: `${C.APP}/c`, lang: "en" });
  assertStringIncludes(retry, "Next attempt");
  assertStringIncludes(retry, "We will try again on July 24.");
});

Deno.test("en: dunning attempt label", () => {
  assertEquals(formatAttemptLabel("2026-07-24T10:00:00.000Z", "en"), "July 24");
  assertEquals(formatAttemptLabel(null, "en"), null);
});

Deno.test("en: instagram connect link and notice", () => {
  const html = buildConnectLinkEmail({ agencyName: "Lume", ...C.CONNECT, lang: "en" });
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "Connect Instagram");
  assertStringIncludes(html, "The agency never sees your password.");
  assertEquals(connectLinkSubject("Lume", "en"), "Lume needs to connect your Instagram");
  assert(!/[\r\n]/.test(connectLinkSubject("A\r\nB", "en")), "control characters stripped from the subject");
  const n = buildConnectedNoticeEmail({ ...C.CONNECTED, lang: "en" });
  assertStringIncludes(n, '<html lang="en"');
  assertStringIncludes(n, "Instagram connected");
  assertStringIncludes(n, "Connected account:");
  assertEquals(connectedNoticeSubject("en"), "Instagram connected by the client");
});

Deno.test("en: report e-mail and subject", () => {
  const html = buildReportEmail({
    ...C.REPORT_BASE, lang: "en",
    emailKpis: { views: { value: 48200, pct_change: 18 }, interactions: { value: 1200 }, followers_gained: { value: 87 } },
  } as never);
  assertStringIncludes(html, '<html lang="en"');
  assertStringIncludes(html, "Views +18% in September 2026. See the full report.");
  assertStringIncludes(html, "Monthly report");
  assertStringIncludes(html, "48.2K");
  assertStringIncludes(html, "Followers");
  assertStringIncludes(html, "View full report");
  assertStringIncludes(html, "Download PDF");
  assertStringIncludes(html, "Sent by Agencia Lume via Mesaas".replace("Agencia", "Agência"));
  assertEquals(buildReportSubject("2026-09", "en"), "Your September report is ready!");
});

Deno.test("fallbackLink: pt default, en on request", () => {
  assertStringIncludes(fallbackLink("https://a.test/x"), "Se o botão não funcionar");
  assertStringIncludes(fallbackLink("https://a.test/x", "en"), "If the button does not work");
});

// --- language lookup ----------------------------------------------------------

Deno.test("workspaceLang: failure and unknown values give pt", async () => {
  const db = (data: unknown, error: unknown = null) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }) }),
  });
  assertEquals(await workspaceLang(db({ language: "en" }), "c"), "en");
  assertEquals(await workspaceLang(db({ language: "fr" }), "c"), "pt");
  assertEquals(await workspaceLang(db(null), "c"), "pt");
  assertEquals(await workspaceLang(db(null, { message: "x" }), "c"), "pt");
});
