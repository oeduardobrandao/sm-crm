import { assertEquals } from "./assert.ts";
import { refineMapping } from "../_shared/import-ai.ts";

const SUMMARY = {
  collections: [
    {
      collectionId: "c1",
      name: "Calendário",
      source: "trello",
      columns: ["Nome"],
      listNames: ["Rascunho", "Aprovado"],
      rowCount: 2,
      sampleCells: { Nome: ["Post A", "Post B"] },
    },
  ],
};
const HEURISTIC = {
  collections: [
    {
      collectionId: "c1",
      destination: "ideias" as const,
      columnRoles: {},
      statusMap: {},
      clientAssignment: { mode: "fixed" as const, clienteNome: "" },
    },
  ],
};

function geminiOk(payload: unknown): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
      { status: 200 },
    )) as typeof fetch;
}

Deno.test("refineMapping: merges a valid AI answer over the heuristic proposal", async () => {
  const ai = {
    collections: [
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles: { title: "Nome" },
        statusMap: { Rascunho: "rascunho", Aprovado: "aprovado_cliente" },
        clientAssignment: { mode: "fixed", clienteNome: "Dra. Marina" },
      },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections[0].destination, "posts");
  assertEquals(out!.collections[0].statusMap.Aprovado, "aprovado_cliente");
});

Deno.test("refineMapping: rejects forbidden status values (agendado) and unknown collections", async () => {
  const ai = {
    collections: [
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles: {},
        statusMap: { X: "agendado" },
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
      {
        collectionId: "ghost",
        destination: "posts",
        columnRoles: {},
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections.length, 1);
  assertEquals(out!.collections[0].statusMap.X, "rascunho"); // forbidden value clamped
});

Deno.test("refineMapping: returns null on API failure or malformed JSON", async () => {
  const fail = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assertEquals(await refineMapping(SUMMARY, HEURISTIC, "key", fail), null);
  const garbage = (async () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "not json" }] } }],
      }),
      { status: 200 },
    )) as typeof fetch;
  assertEquals(await refineMapping(SUMMARY, HEURISTIC, "key", garbage), null);
});
