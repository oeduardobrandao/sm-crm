// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from "./assert.ts";
import { fakeServer, insertPayload, makeDeps, makeFakeDb } from "./mcp-financeiro-helpers.ts";
import { registerAgendaTools } from "../mcp/agenda-tools.ts";
import type { RegisteredTool } from "../mcp/queries.ts";

const NAMES = [
  ["list_agenda_events", "agenda:read"],
  ["get_agenda_event", "agenda:read"],
  ["create_agenda_event", "agenda:write"],
  ["update_agenda_event", "agenda:write"],
  ["delete_agenda_event", "agenda:write"],
] as const;

const ARGS: Record<string, any> = {
  list_agenda_events: { from: "2026-12-01", to: "2026-12-07" },
  get_agenda_event: { occurrence_id: 1 },
  create_agenda_event: { title: "x", start: "2026-12-01T10:00", end: "2026-12-01T11:00" },
  update_agenda_event: { occurrence_id: 1, scope: "this", title: "y" },
  delete_agenda_event: { occurrence_id: 1, scope: "this" },
};

Deno.test("mcp-agenda-tools: registry lists the 5 tools with their scopes, never ownerOnly", () => {
  const { db } = makeFakeDb({});
  const registry: RegisteredTool[] = [];
  registerAgendaTools(fakeServer(), makeDeps(db, {}, registry));
  assertEquals(registry.map((r) => [r.name, r.scope]), NAMES.map((n) => [n[0], n[1]]));
  assert(registry.every((r) => r.ownerOnly === false));
});

Deno.test("mcp-agenda-tools: each tool denies a ctx without its scope", async () => {
  for (const [name] of NAMES) {
    const { db, calls } = makeFakeDb({});
    const server = fakeServer();
    registerAgendaTools(server, makeDeps(db, { scopes: ["clientes:write"] }));
    const res = await server.handlers[name](ARGS[name]);
    assert(res.isError === true, `${name} isError`);
    assert(JSON.parse(res.content[0].text).error.includes("agenda:"), `${name} names the scope`);
    assertEquals(calls.length, 0, `${name} touched nothing`);
  }
  // read scope does not open the write tools
  for (const name of ["create_agenda_event", "update_agenda_event", "delete_agenda_event"]) {
    const { db } = makeFakeDb({});
    const server = fakeServer();
    registerAgendaTools(server, makeDeps(db, { scopes: ["agenda:read"] }));
    assert((await server.handlers[name](ARGS[name])).isError === true, name);
  }
});

Deno.test("mcp-agenda-tools: create audit has no free text, keys or values", async () => {
  const { db, calls } = makeFakeDb(
    { audit_log: [{ data: null, error: null }], membros: [{ data: [{ id: 1, crm_user_id: "u1" }, { id: 2, crm_user_id: "u2" }], error: null }] },
    { agenda_evento_criar_as: [{ data: [{ evento_id: 7, ocorrencia_id: 9 }], error: null }] },
  );
  const server = fakeServer();
  registerAgendaTools(server, makeDeps(db, { scopes: ["agenda:write"] }));
  const res = await server.handlers["create_agenda_event"]({
    title: "SEGREDO-TITULO",
    description: "SEGREDO-DESC",
    location: "SEGREDO-LOCAL",
    meeting_link: "https://SEGREDO-LINK.example",
    start: "2026-12-01T10:00",
    end: "2026-12-01T11:00",
    client_id: 3,
    participant_member_ids: [1, 2],
  });
  assert(!res.isError, res.content[0].text);
  const row = insertPayload(calls, "audit_log") as any;
  assertEquals(row.resource_id, "3");
  const text = JSON.stringify(row);
  assert(!text.includes("SEGREDO"), "no free-text values");
  assert(Array.isArray(row.metadata.args.fields), "fields are names");
  assertEquals(row.metadata.args.participants, 2);
  assertEquals(row.metadata.args.occurrence_id, 9);
  assertEquals(row.metadata.args.client_id, 3);
});

Deno.test("mcp-agenda-tools: delete audit carries id and scope, resource_id is the occurrence", async () => {
  const { db, calls } = makeFakeDb({ audit_log: [{ data: null, error: null }] }, { agenda_evento_excluir_as: [{ data: null, error: null }] });
  const server = fakeServer();
  registerAgendaTools(server, makeDeps(db, { scopes: ["agenda:write"] }));
  await server.handlers["delete_agenda_event"]({ occurrence_id: 42, scope: "all" });
  const row = insertPayload(calls, "audit_log") as any;
  assertEquals(row.resource_id, "42");
  assertEquals(row.metadata.args, { occurrence_id: 42, scope: "all" });
});

Deno.test("mcp-agenda-tools: descriptions have no em dash and state the time contract", () => {
  const { db } = makeFakeDb({});
  const server = fakeServer();
  registerAgendaTools(server, makeDeps(db));
  for (const [name] of NAMES) assert(!server.descriptions[name].includes("—"), name);
  assert(server.descriptions["create_agenda_event"].includes("YYYY-MM-DDTHH:MM"));
  assert(server.descriptions["create_agenda_event"].includes("start_date"));
});
