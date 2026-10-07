import { assert, assertEquals, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import { dobrar, escaparTexto, gerarCalendario, type IcsEvento } from "../_shared/ics.ts";

const AGORA = new Date("2026-10-06T12:00:00Z");

function evento(over: Partial<IcsEvento> = {}): IcsEvento {
  return {
    uid: "agenda-oc-7@mesaas.com.br",
    inicio: new Date("2026-10-07T13:00:00Z"),
    fim: new Date("2026-10-07T14:30:00Z"),
    diaInteiro: false,
    titulo: "Gravação",
    ...over,
  };
}

function cal(eventos: IcsEvento[], nome = "Mesaas: Agência"): string {
  return gerarCalendario({ nome, eventos, agora: AGORA });
}

/** RFC 5545 unfolding: a CRLF followed by one space joins the lines. */
function desdobrar(texto: string): string {
  return texto.replace(/\r\n /g, "");
}

Deno.test("escaparTexto: escapes backslash, semicolon, comma and newline", () => {
  assertEquals(escaparTexto("a\\b;c,d\ne"), "a\\\\b\\;c\\,d\\ne");
});

Deno.test("gerarCalendario: SUMMARY escapes backslash, semicolon and comma end to end", () => {
  // Actual title characters: a ; b , c \ d  (one backslash)
  const titulo = String.raw`a;b,c\d`;
  assertEquals(titulo.length, 7);
  const out = cal([evento({ titulo })]);
  // Actual SUMMARY bytes: a \; b \, c \\ d  (every special char gets one backslash)
  assertStringIncludes(out, String.raw`SUMMARY:a\;b\,c\\d` + "\r\n");
});

Deno.test("escaparTexto: normalizes CRLF and strips control characters", () => {
  assertEquals(escaparTexto("a\r\nb"), "a\\nb");
  assertEquals(escaparTexto("a\rb"), "a\\nb");
  assertEquals(escaparTexto("a\u0000b\u0007c\u001fd\u007fe"), "abcde");
});

Deno.test("gerarCalendario: every line ends with CRLF and there is no bare LF", () => {
  const out = cal([evento({ descricao: "linha 1\nlinha 2" })]);
  assert(out.endsWith("\r\n"));
  assertEquals(out.replace(/\r\n/g, "").includes("\n"), false);
  assertEquals(out.replace(/\r\n/g, "").includes("\r"), false);
});

Deno.test("gerarCalendario: no line exceeds 75 octets and unfolding restores the value", () => {
  const titulo = Array.from("Ação ç ã 🎬 ".repeat(30)).slice(0, 200).join("");
  const out = cal([evento({ titulo })]);
  const enc = new TextEncoder();
  const linhas = out.split("\r\n");
  for (const linha of linhas) {
    assert(enc.encode(linha).length <= 75, `linha longa demais: ${linha}`);
  }
  assert(linhas.some((l) => l.startsWith(" ")), "esperava ao menos uma linha dobrada");
  assertStringIncludes(desdobrar(out), `SUMMARY:${escaparTexto(titulo)}\r\n`);
});

Deno.test("dobrar: never splits a multibyte character at the boundary", () => {
  // 74 ASCII octets + a 4-octet emoji: the emoji must move to the next line whole.
  const linha = "X".repeat(74) + "🎬" + "Y";
  const dobrada = dobrar(linha);
  const partes = dobrada.split("\r\n ");
  assertEquals(partes.length, 2);
  assertEquals(partes[0], "X".repeat(74));
  assertEquals(partes[1], "🎬Y");
  assertEquals(desdobrar(dobrada), linha);
});

Deno.test("dobrar: short line is untouched", () => {
  assertEquals(dobrar("SUMMARY:oi"), "SUMMARY:oi");
});

Deno.test("gerarCalendario: timed event is written in UTC", () => {
  const out = cal([evento()]);
  assertStringIncludes(out, "DTSTART:20261007T130000Z\r\n");
  assertStringIncludes(out, "DTEND:20261007T143000Z\r\n");
  assertStringIncludes(out, "DTSTAMP:20261006T120000Z\r\n");
  assertStringIncludes(out, "UID:agenda-oc-7@mesaas.com.br\r\n");
  assertStringIncludes(out, "TRANSP:OPAQUE\r\n");
});

Deno.test("gerarCalendario: all-day event uses DATE values with exclusive end", () => {
  const out = cal([evento({ diaInteiro: true, dataInicio: "2026-10-07", dataFim: "2026-10-08" })]);
  assertStringIncludes(out, "DTSTART;VALUE=DATE:20261007\r\n");
  assertStringIncludes(out, "DTEND;VALUE=DATE:20261008\r\n");
  assertEquals(out.includes("DTSTART:2026"), false);
});

Deno.test("gerarCalendario: all-day without local dates throws instead of emitting a timed event", () => {
  assertThrows(() => cal([evento({ diaInteiro: true })]));
  assertThrows(() => cal([evento({ diaInteiro: true, dataInicio: "2026-10-07" })]));
});

Deno.test("gerarCalendario: javascript: url is dropped from URL and DESCRIPTION", () => {
  const out = cal([evento({ url: "javascript:alert(1)", descricao: "pauta" })]);
  assertEquals(out.includes("URL:"), false);
  assertEquals(out.includes("javascript"), false);
  assertEquals(out.includes("Link da reunião"), false);
  assertStringIncludes(out, "DESCRIPTION:pauta\r\n");
});

Deno.test("gerarCalendario: https url becomes URL and a description footer", () => {
  const out = cal([evento({ url: "https://meet.example.test/abc", descricao: "pauta" })]);
  assertStringIncludes(out, "URL:https://meet.example.test/abc\r\n");
  assertStringIncludes(
    desdobrar(out),
    "DESCRIPTION:pauta\\n\\nLink da reunião: https://meet.example.test/abc\r\n",
  );
});

Deno.test("gerarCalendario: link alone (no description) has no leading blank lines", () => {
  const out = cal([evento({ url: "http://meet.example.test/x" })]);
  assertStringIncludes(desdobrar(out), "DESCRIPTION:Link da reunião: http://meet.example.test/x\r\n");
});

Deno.test("gerarCalendario: LOCATION is emitted and escaped; empty ones are omitted", () => {
  assertStringIncludes(cal([evento({ local: "Sala 1, bloco A" })]), "LOCATION:Sala 1\\, bloco A\r\n");
  assertEquals(cal([evento({ local: "   " })]).includes("LOCATION"), false);
  assertEquals(cal([evento({ descricao: "  " })]).includes("DESCRIPTION"), false);
});

Deno.test("gerarCalendario: no RRULE, SEQUENCE or LAST-MODIFIED", () => {
  const out = cal([evento()]);
  for (const proibido of ["RRULE", "SEQUENCE", "LAST-MODIFIED"]) {
    assertEquals(out.includes(proibido), false, proibido);
  }
});

Deno.test("gerarCalendario: empty list is a valid calendar without VEVENT", () => {
  const out = cal([]);
  assertEquals(
    out,
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Mesaas//Agenda//PT-BR",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Mesaas: Agência",
      "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
      "X-PUBLISHED-TTL:PT1H",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  assertEquals(out.includes("VEVENT"), false);
});

Deno.test("gerarCalendario: one VEVENT block per event, in order", () => {
  const out = cal([
    evento({ uid: "agenda-oc-1@mesaas.com.br" }),
    evento({ uid: "agenda-oc-2@mesaas.com.br" }),
  ]);
  assertEquals(out.match(/BEGIN:VEVENT/g)?.length, 2);
  assertEquals(out.match(/END:VEVENT/g)?.length, 2);
  assert(out.indexOf("agenda-oc-1@") < out.indexOf("agenda-oc-2@"));
});
