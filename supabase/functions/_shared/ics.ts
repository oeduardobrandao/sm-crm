// Pure iCalendar (RFC 5545) builder shared by agenda-feed (personal feed and
// per-occurrence download) and, later, the client-event e-mails. No I/O.
// Spec: docs/superpowers/specs/2026-10-06-agenda-google-ics-feed-design.md

export interface IcsEvento {
  uid: string;
  /** Used when !diaInteiro; written as UTC ('Z'). */
  inicio: Date;
  fim: Date;
  diaInteiro: boolean;
  /** YYYY-MM-DD, required when diaInteiro. */
  dataInicio?: string;
  /** YYYY-MM-DD, exclusive end, required when diaInteiro. */
  dataFim?: string;
  titulo: string;
  descricao?: string | null;
  local?: string | null;
  /** Meeting link; only http(s) is emitted. */
  url?: string | null;
  /** RFC 5545 SEQUENCE; omitted (not written) when undefined so the
   *  personal feed's output is unchanged when callers don't pass it. */
  sequencia?: number;
}

const CRLF = "\r\n";
const enc = new TextEncoder();

/** TEXT value escaping (RFC 5545 3.3.11); also drops control characters. */
export function escaparTexto(v: string): string {
  return v
    .replace(/\r\n?/g, "\n")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Folds at 75 octets without splitting a UTF-8 sequence (RFC 5545 3.1). */
export function dobrar(linha: string): string {
  const partes: string[] = [];
  let atual = "";
  let bytes = 0;
  let limite = 75;
  for (const ch of linha) {
    const n = enc.encode(ch).length;
    if (bytes + n > limite) {
      partes.push(atual);
      atual = "";
      bytes = 0;
      limite = 74; // continuation lines start with one space
    }
    atual += ch;
    bytes += n;
  }
  partes.push(atual);
  return partes.join(CRLF + " ");
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function data(d: string): string {
  return d.replace(/-/g, "");
}

function urlSegura(u?: string | null): string | null {
  // No whitespace or control characters: URL: is emitted unescaped, so a CR/LF
  // here would inject content lines (the DB only anchors ^https?://).
  // deno-lint-ignore no-control-regex
  return u && /^https?:\/\/[^\s\x00-\x1f\x7f]+$/i.test(u) ? u : null;
}

export function gerarCalendario(
  { nome, eventos, agora }: { nome: string; eventos: IcsEvento[]; agora: Date },
): string {
  const l: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mesaas//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escaparTexto(nome)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const e of eventos) {
    const url = urlSegura(e.url);
    const desc = [e.descricao?.trim() || null, url ? `Link da reunião: ${url}` : null]
      .filter(Boolean)
      .join("\n\n");
    l.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utc(agora)}`);
    if (e.sequencia !== undefined) l.push(`SEQUENCE:${Math.max(0, Math.trunc(e.sequencia))}`);
    if (e.diaInteiro) {
      if (!e.dataInicio || !e.dataFim) {
        // Caller bug (all-day row without local dates): fail loudly rather
        // than silently emitting a timed event on the wrong day.
        throw new Error("ics: dia inteiro sem dataInicio/dataFim");
      }
      l.push(`DTSTART;VALUE=DATE:${data(e.dataInicio)}`, `DTEND;VALUE=DATE:${data(e.dataFim)}`);
    } else {
      l.push(`DTSTART:${utc(e.inicio)}`, `DTEND:${utc(e.fim)}`);
    }
    l.push(`SUMMARY:${escaparTexto(e.titulo)}`);
    if (desc) l.push(`DESCRIPTION:${escaparTexto(desc)}`);
    if (e.local?.trim()) l.push(`LOCATION:${escaparTexto(e.local.trim())}`);
    if (url) l.push(`URL:${url}`);
    l.push("TRANSP:OPAQUE", "END:VEVENT");
  }
  l.push("END:VCALENDAR");
  return l.map(dobrar).join(CRLF) + CRLF;
}
