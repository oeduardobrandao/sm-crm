import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  type AgendaFeedDeps,
  classificarErroRpc,
  createAgendaFeedHandler,
  type FeedEventoRow,
  type FeedResultado,
  type ListarOcorrenciaResultado,
  type OcorrenciaIcs,
  slugAscii,
} from "../agenda-feed/handler.ts";

const TOKEN = "0123456789abcdef".repeat(4);
const BASE = "https://proj.supabase.co/agenda-feed";
const CORS = { "Access-Control-Allow-Origin": "https://app.test" };

function feedRow(over: Partial<FeedEventoRow> = {}): FeedEventoRow {
  return {
    ocorrencia_id: 11,
    evento_id: 3,
    data_original: "2026-10-07",
    inicio: "2026-10-07T13:00:00+00:00",
    fim: "2026-10-07T14:00:00+00:00",
    dia_inteiro: false,
    data_inicio_local: "2026-10-07",
    data_fim_local: "2026-10-07",
    titulo: "Gravação",
    descricao: null,
    local: null,
    link_reuniao: null,
    tz: "America/Sao_Paulo",
    ...over,
  };
}

function ocRow(over: Partial<OcorrenciaIcs> = {}): OcorrenciaIcs {
  return {
    ocorrencia_id: 42,
    inicio: "2026-10-07T13:00:00+00:00",
    fim: "2026-10-07T14:00:00+00:00",
    dia_inteiro: false,
    data_inicio_local: "2026-10-07",
    data_fim_local: "2026-10-07",
    titulo: "Reunião de planejamento: Q4/2026",
    descricao: "Pauta",
    local: null,
    link_reuniao: null,
    mascarado: false,
    ...over,
  };
}

interface Harness {
  handler: (req: Request) => Promise<Response>;
  calls: {
    feedEventos: string[];
    getUser: string[];
    listar: Array<{ jwt: string; id: number }>;
    rateLimit: Array<{ key: string; max: number; win: number }>;
  };
}

function harness(
  over: Partial<AgendaFeedDeps> = {},
  rateLimits: boolean[] = [],
  feed: FeedResultado | null = null,
): Harness {
  const calls: Harness["calls"] = { feedEventos: [], getUser: [], listar: [], rateLimit: [] };
  const fila = [...rateLimits];
  const deps: AgendaFeedDeps = {
    buildCorsHeaders: () => CORS,
    feedEventos: (t) => {
      calls.feedEventos.push(t);
      return Promise.resolve(feed);
    },
    getUser: (jwt) => {
      calls.getUser.push(jwt);
      return Promise.resolve({ id: "u1" });
    },
    listarOcorrencia: (jwt, id) => {
      calls.listar.push({ jwt, id });
      return Promise.resolve<ListarOcorrenciaResultado>({ rows: [ocRow()] });
    },
    rateLimit: (key, max, win) => {
      calls.rateLimit.push({ key, max, win });
      return Promise.resolve(fila.length ? fila.shift()! : true);
    },
    hashToken: (t) => Promise.resolve(`h:${t}`),
    clientIP: () => "203.0.113.9",
    now: () => new Date("2026-10-06T12:00:00Z"),
    ...over,
  };
  return { handler: createAgendaFeedHandler(deps), calls };
}

function get(path: string, init: RequestInit = {}): Request {
  return new Request(`${BASE}${path}`, init);
}

function comFeed(feed: FeedResultado | null, rateLimits: boolean[] = []): Harness {
  return harness({}, rateLimits, feed);
}

// ---------------------------------------------------------------- feed route

Deno.test("feed: malformed token is a 404 and never touches the database", async () => {
  for (const p of ["/abc.ics", `/${TOKEN.toUpperCase()}.ics`, `/${TOKEN}a.ics`, `/${TOKEN.slice(1)}.ics`, `/${"g".repeat(64)}.ics`]) {
    const h = harness();
    const res = await h.handler(get(p));
    assertEquals(res.status, 404, p);
    assertEquals(h.calls.feedEventos.length, 0, p);
    assertEquals(h.calls.rateLimit.length, 0, p);
  }
});

Deno.test("feed: unknown token debits the per-IP bad-token limit then answers 404", async () => {
  const h = comFeed(null);
  const res = await h.handler(get(`/${TOKEN}.ics`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Não encontrado" });
  assertEquals(h.calls.feedEventos, [TOKEN]);
  assertEquals(h.calls.rateLimit, [{ key: "agenda-feed-badtoken:203.0.113.9", max: 30, win: 600 }]);
});

Deno.test("feed: exhausted bad-token limit answers 429", async () => {
  const h = comFeed(null, [false]);
  const res = await h.handler(get(`/${TOKEN}.ics`));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "Muitas requisições" });
});

Deno.test("feed: valid token over the per-token limit answers 429 without the bad-token debit", async () => {
  const h = comFeed({ estado: "ok", workspace_nome: "Agência", eventos: [feedRow()] }, [false]);
  const res = await h.handler(get(`/${TOKEN}.ics`));
  assertEquals(res.status, 429);
  assertEquals(h.calls.rateLimit, [{ key: `agenda-feed:h:${TOKEN}`, max: 60, win: 3600 }]);
});

Deno.test("feed: desligado answers 200 with an empty calendar", async () => {
  const h = comFeed({ estado: "desligado", workspace_nome: "Agência", eventos: [] });
  const res = await h.handler(get(`/${TOKEN}.ics`));
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, "BEGIN:VCALENDAR\r\n");
  assertStringIncludes(body, "END:VCALENDAR\r\n");
  assertEquals(body.includes("VEVENT"), false);
  assertStringIncludes(body, "X-WR-CALNAME:Mesaas: Agência\r\n");
});

Deno.test("feed: ok answers 200 with headers, UIDs and the workspace calendar name", async () => {
  const h = comFeed({
    estado: "ok",
    workspace_nome: "Agência Teste",
    eventos: [
      feedRow({ ocorrencia_id: 11 }),
      feedRow({
        ocorrencia_id: 12,
        dia_inteiro: true,
        inicio: "2026-10-08T03:00:00+00:00",
        fim: "2026-10-09T03:00:00+00:00",
        data_inicio_local: "2026-10-08",
        data_fim_local: "2026-10-09",
        titulo: "Feriado",
      }),
    ],
  });
  const res = await h.handler(get(`/${TOKEN}.ics`));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assertEquals(res.headers.get("Cache-Control"), "private, max-age=300");
  assertEquals(res.headers.get("Content-Disposition"), 'inline; filename="mesaas-agenda.ics"');
  const body = await res.text();
  assertStringIncludes(body, "UID:agenda-oc-11@mesaas.com.br\r\n");
  assertStringIncludes(body, "UID:agenda-oc-12@mesaas.com.br\r\n");
  assertStringIncludes(body, "X-WR-CALNAME:Mesaas: Agência Teste\r\n");
  assertStringIncludes(body, "DTSTART:20261007T130000Z\r\n");
  assertStringIncludes(body, "DTSTART;VALUE=DATE:20261008\r\n");
  assertStringIncludes(body, "DTEND;VALUE=DATE:20261009\r\n");
  assertStringIncludes(body, "DTSTAMP:20261006T120000Z\r\n");
  // Valid token: exactly one rate-limit debit, the per-token one.
  assertEquals(h.calls.rateLimit, [{ key: `agenda-feed:h:${TOKEN}`, max: 60, win: 3600 }]);
});

Deno.test("feed: ok with a missing eventos array answers an empty calendar", async () => {
  const feed = { estado: "ok", workspace_nome: "Agência" } as unknown as FeedResultado;
  const res = await comFeed(feed).handler(get(`/${TOKEN}.ics`));
  assertEquals(res.status, 200);
  const body = await res.text();
  assertStringIncludes(body, "END:VCALENDAR\r\n");
  assertEquals(body.includes("VEVENT"), false);
});

Deno.test("feed: HEAD mirrors GET status and headers with an empty body", async () => {
  const feed: FeedResultado = { estado: "ok", workspace_nome: "Agência", eventos: [feedRow()] };
  const g = await comFeed(feed).handler(get(`/${TOKEN}.ics`));
  const h = await comFeed(feed).handler(get(`/${TOKEN}.ics`, { method: "HEAD" }));
  assertEquals(h.status, g.status);
  for (const k of ["Content-Type", "Cache-Control", "Content-Disposition"]) {
    assertEquals(h.headers.get(k), g.headers.get(k), k);
  }
  assertEquals(await h.text(), "");
  assert((await g.text()).length > 0);
});

Deno.test("feed: a failing rpc answers a generic 500 and the token never reaches the logs", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const h = harness({
      feedEventos: () => Promise.reject(new Error(`agenda_feed_eventos: boom for ${TOKEN}`)),
    });
    const res = await h.handler(get(`/${TOKEN}.ics`));
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: "Erro interno" });
  } finally {
    console.error = original;
  }
  assert(logged.length > 0, "the failure should be logged");
  for (const linha of logged) assertEquals(linha.includes(TOKEN), false);
});

Deno.test("feed: other paths and methods are 404", async () => {
  const h = harness();
  assertEquals((await h.handler(get(""))).status, 404);
  assertEquals((await h.handler(get("/"))).status, 404);
  assertEquals((await h.handler(get("/foo/bar.ics"))).status, 404);
  assertEquals((await h.handler(get(`/${TOKEN}.ics`, { method: "POST" }))).status, 404);
  assertEquals((await h.handler(get(`/${TOKEN}.ics`, { method: "OPTIONS" }))).status, 404);
  assertEquals(h.calls.feedEventos.length, 0);
});

Deno.test("feed: tolerates the /functions/v1 gateway prefix", async () => {
  const h = comFeed({ estado: "desligado", workspace_nome: "Agência", eventos: [] });
  const res = await h.handler(new Request(`https://proj.supabase.co/functions/v1/agenda-feed/${TOKEN}.ics`));
  assertEquals(res.status, 200);
});

// ------------------------------------------------------------ download route

const JWT = "header.payload.sig";
const auth = { Authorization: `Bearer ${JWT}` };

Deno.test("download: OPTIONS answers 204 with CORS and no work", async () => {
  const h = harness();
  const res = await h.handler(get("/ocorrencia/42.ics", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assertEquals(h.calls.getUser.length, 0);
  assertEquals(h.calls.listar.length, 0);
});

Deno.test("download: no Authorization header is a 401", async () => {
  const h = harness();
  const res = await h.handler(get("/ocorrencia/42.ics"));
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Não autorizado" });
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assertEquals(h.calls.getUser.length, 0);
});

Deno.test("download: a non-Bearer Authorization header is a 401", async () => {
  const h = harness();
  const res = await h.handler(get("/ocorrencia/42.ics", { headers: { Authorization: "Basic abc" } }));
  assertEquals(res.status, 401);
});

Deno.test("download: getUser returning null is a 401 and agenda_listar is not called", async () => {
  const h = harness({ getUser: () => Promise.resolve(null) });
  const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
  assertEquals(res.status, 401);
  assertEquals(h.calls.listar.length, 0);
});

Deno.test("download: rpc jwt error is 401, negado is 404, outro is a generic 500", async () => {
  const casos: Array<["jwt" | "negado" | "outro", number, string]> = [
    ["jwt", 401, "Não autorizado"],
    ["negado", 404, "Não encontrado"],
    ["outro", 500, "Erro interno"],
  ];
  for (const [erro, status, msg] of casos) {
    const h = harness({ listarOcorrencia: () => Promise.resolve({ erro }) });
    const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
    assertEquals(res.status, status, erro);
    assertEquals(await res.json(), { error: msg }, erro);
  }
});

Deno.test("download: a throwing dependency is a generic 500 that does not log the JWT", async () => {
  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => String(a)).join(" "));
  };
  try {
    const h = harness({ getUser: () => Promise.reject(new Error(`down ${JWT}`)) });
    const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
    assertEquals(res.status, 500);
  } finally {
    console.error = original;
  }
  for (const linha of logged) assertEquals(linha.includes(JWT), false);
});

Deno.test("download: zero rows (deleted, cancelled, other workspace, flag off) is a 404", async () => {
  const h = harness({ listarOcorrencia: () => Promise.resolve({ rows: [] }) });
  const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
  assertEquals(res.status, 404);
});

Deno.test("download: a masked occurrence is a 404", async () => {
  const h = harness({
    listarOcorrencia: () => Promise.resolve({ rows: [ocRow({ mascarado: true, titulo: "Ocupado" })] }),
  });
  const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
  assertEquals(res.status, 404);
});

Deno.test("download: invalid ids are a 404 and nothing is called", async () => {
  for (const id of ["abc", "0", "-1", "1.5", "1e3", "007x", "99999999999999999999"]) {
    const h = harness();
    const res = await h.handler(get(`/ocorrencia/${id}.ics`, { headers: auth }));
    assertEquals(res.status, 404, id);
    assertEquals(h.calls.getUser.length, 0, id);
    assertEquals(h.calls.listar.length, 0, id);
  }
});

Deno.test("download: ok answers 200 with an attachment, CORS and the occurrence UID", async () => {
  const h = harness();
  const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/calendar; charset=utf-8");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://app.test");
  assertEquals(
    res.headers.get("Content-Disposition"),
    `attachment; filename="reuniao-de-planejamento-q4-2026.ics"; filename*=UTF-8''Reuni%C3%A3o%20de%20planejamento%3A%20Q4%2F2026.ics`,
  );
  assertEquals(h.calls.getUser, [JWT]);
  assertEquals(h.calls.listar, [{ jwt: JWT, id: 42 }]);
  const body = await res.text();
  assertStringIncludes(body, "UID:agenda-oc-42@mesaas.com.br\r\n");
  assertStringIncludes(body, "X-WR-CALNAME:Reunião de planejamento: Q4/2026\r\n");
  assertStringIncludes(body, "SUMMARY:Reunião de planejamento: Q4/2026\r\n");
  assertStringIncludes(body, "DESCRIPTION:Pauta\r\n");
});

Deno.test("download: an emoji-only title falls back to an ASCII stem and keeps the UTF-8 name", async () => {
  const h = harness({
    listarOcorrencia: () => Promise.resolve({ rows: [ocRow({ titulo: "🎬" })] }),
  });
  const res = await h.handler(get("/ocorrencia/42.ics", { headers: auth }));
  assertEquals(
    res.headers.get("Content-Disposition"),
    `attachment; filename="evento.ics"; filename*=UTF-8''%F0%9F%8E%AC.ics`,
  );
});

Deno.test("download: other methods are 404", async () => {
  const h = harness();
  assertEquals((await h.handler(get("/ocorrencia/42.ics", { method: "POST", headers: auth }))).status, 404);
  assertEquals(h.calls.getUser.length, 0);
});

// ------------------------------------------------------------------- helpers

Deno.test("classificarErroRpc: status 401 and PGRST30x are jwt errors", () => {
  assertEquals(classificarErroRpc(401, { code: "PGRST301", message: "JWT expired" }), "jwt");
  assertEquals(classificarErroRpc(401, { message: "anything" }), "jwt");
  assertEquals(classificarErroRpc(400, { code: "PGRST302", message: "Anonymous access is disabled" }), "jwt");
  assertEquals(classificarErroRpc(400, { code: "PGRST303", message: "x" }), "jwt");
});

Deno.test("classificarErroRpc: agenda and feature_disabled raises are negado", () => {
  assertEquals(classificarErroRpc(400, { code: "P0001", message: "agenda: você não pode ver a agenda" }), "negado");
  assertEquals(classificarErroRpc(400, { code: "P0001", message: "agenda: sessão sem workspace ativo" }), "negado");
  assertEquals(classificarErroRpc(400, { code: "P0001", message: "feature_disabled:feature_agenda" }), "negado");
});

Deno.test("classificarErroRpc: everything else is outro, and no error is null", () => {
  assertEquals(classificarErroRpc(400, { code: "P0001", message: "something else" }), "outro");
  assertEquals(classificarErroRpc(500, { code: "XX000", message: "agenda: not a P0001" }), "outro");
  assertEquals(classificarErroRpc(503, { message: "upstream" }), "outro");
  assertEquals(classificarErroRpc(200, null), null);
});

Deno.test("slugAscii: strips accents and symbols, caps the length, never returns empty", () => {
  assertEquals(slugAscii("Reunião de planejamento: Q4/2026"), "reuniao-de-planejamento-q4-2026");
  assertEquals(slugAscii("🎬"), "evento");
  assertEquals(slugAscii("   "), "evento");
  assert(slugAscii("a".repeat(200)).length <= 60);
});
