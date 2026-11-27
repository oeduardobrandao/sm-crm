/**
 * Registry of every edge i18n catalog. Tasks 8-11 append one line to CATALOGS.
 * Asserts pt/en have deep-identical key sets and that no `en` string (function
 * outputs included, called with SAMPLE_ARGS) has accented chars or an em-dash.
 */
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shellText } from "../_shared/email/shell.ts";
import { lifecycleText } from "../_shared/i18n/catalogs/lifecycle.ts";
import { nurtureText } from "../_shared/i18n/catalogs/nurture.ts";
import { nurtureUnsubText } from "../_shared/i18n/catalogs/nurture-unsub.ts";
import { notificationsText } from "../_shared/i18n/catalogs/notifications.ts";
import { inviteText } from "../_shared/i18n/catalogs/invite.ts";
import { dunningText } from "../_shared/i18n/catalogs/dunning.ts";
import { instagramConnectText } from "../_shared/i18n/catalogs/instagram-connect.ts";
import { reportEmailText } from "../_shared/i18n/catalogs/report-email.ts";
import { clientEventText } from "../_shared/i18n/catalogs/client-event.ts";
import { agendaText } from "../_shared/i18n/catalogs/agenda.ts";
import { hubLoginText } from "../_shared/i18n/catalogs/hub-login.ts";
import { clientUnsubText } from "../_shared/i18n/catalogs/client-unsub.ts";

type Entry = { name: string; get: (lang: "pt" | "en") => Record<string, unknown> };

const CATALOGS: Entry[] = [
  { name: "email/shell", get: shellText },
  { name: "lifecycle", get: lifecycleText },
  { name: "nurture", get: nurtureText },
  { name: "nurture-unsub", get: nurtureUnsubText },
  { name: "notifications", get: notificationsText },
  { name: "invite", get: inviteText },
  { name: "dunning", get: dunningText },
  { name: "instagram-connect", get: instagramConnectText },
  { name: "report-email", get: reportEmailText },
  { name: "client-event", get: clientEventText },
  { name: "agenda", get: agendaText },
  { name: "hub-login", get: hubLoginText },
  { name: "client-unsub", get: clientUnsubText },
  // Append: { name: "<family>", get: <catalogAccessor> },
];

// Representative arguments for function-valued entries.
const SAMPLE_ARGS = ["Sample", "Sample", "Sample", 3, "2026-01-02T12:00:00Z"];
const BAD = /[À-ÿ—]/;

function keysDeep(v: unknown, prefix = ""): string[] {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return Object.keys(v).sort().flatMap((k) =>
      keysDeep((v as Record<string, unknown>)[k], `${prefix}${k}.`)
    );
  }
  return [`${prefix}:${Array.isArray(v) ? "array" : typeof v}`];
}

function strings(v: unknown, path: string, out: [string, string][]) {
  if (typeof v === "string") out.push([path, v]);
  else if (typeof v === "function") {
    strings((v as (...a: unknown[]) => unknown)(...SAMPLE_ARGS), `${path}()`, out);
  } else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
  }
}

for (const { name, get } of CATALOGS) {
  Deno.test(`catalog ${name}: pt and en have identical keys`, () => {
    assertEquals(keysDeep(get("en")), keysDeep(get("pt")));
  });
  Deno.test(`catalog ${name}: en has no accents or em-dash`, () => {
    const out: [string, string][] = [];
    strings(get("en"), name, out);
    for (const [path, s] of out) {
      assert(!BAD.test(s), `${path} contains a forbidden character: ${s}`);
    }
  });
}
