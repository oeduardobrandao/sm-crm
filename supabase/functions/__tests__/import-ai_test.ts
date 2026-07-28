import { assert, assertEquals } from "./assert.ts";
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

// Like geminiOk, but also records the request body handed to fetch so tests
// can inspect exactly what was sent to Gemini (used by the data-minimization
// clamp test below).
function geminiOkCapturing(payload: unknown, capture: { body?: string }): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    capture.body = init?.body as string;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
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

Deno.test("refineMapping: drops non-string columnRoles values but keeps valid string ones", async () => {
  const ai = {
    collections: [
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles: { title: "Nome", weird: 5 },
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections[0].columnRoles, { title: "Nome" });
});

Deno.test("refineMapping: columnRoles null or array collapses to an empty object", async () => {
  const withColumnRoles = (columnRoles: unknown) => ({
    collections: [
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles,
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
    ],
  });
  const outNull = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(withColumnRoles(null)));
  assertEquals(outNull!.collections[0].columnRoles, {});
  const outEmptyArr = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(withColumnRoles([])));
  assertEquals(outEmptyArr!.collections[0].columnRoles, {});
  // Non-empty array too: an empty array alone can't distinguish "array
  // rejected" from "array happened to produce no entries" (Object.entries([])
  // is already []). This one proves the Array.isArray guard is load-bearing.
  const outArr = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(withColumnRoles(["a", "b"])));
  assertEquals(outArr!.collections[0].columnRoles, {});
});

Deno.test("refineMapping: statusMap given a non-object (null or array) collapses to an empty object", async () => {
  const withStatusMap = (statusMap: unknown) => ({
    collections: [
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles: {},
        statusMap,
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
    ],
  });
  const outNull = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(withStatusMap(null)));
  assertEquals(outNull!.collections[0].statusMap, {});
  // Non-empty array: without the Array.isArray guard, Object.entries(["Aprovado"])
  // yields [["0", "Aprovado"]], which — since "Aprovado" isn't in
  // STATUS_TARGETS — would clamp to { "0": "rascunho" }, not {}.
  const outArr = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(withStatusMap(["Aprovado"])));
  assertEquals(outArr!.collections[0].statusMap, {});
});

Deno.test("refineMapping: clientAssignment null falls back to a fixed empty assignment", async () => {
  const ai = {
    collections: [
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles: {},
        statusMap: {},
        clientAssignment: null,
      },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections[0].clientAssignment, { mode: "fixed", clienteNome: "" });
});

Deno.test("refineMapping: returns null when every collection in the AI response is unknown", async () => {
  const ai = {
    collections: [
      {
        collectionId: "ghost1",
        destination: "posts",
        columnRoles: {},
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
      {
        collectionId: "ghost2",
        destination: "clientes",
        columnRoles: {},
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out, null); // caller keeps its heuristic proposal
});

Deno.test("refineMapping: a duplicated collectionId in the AI response collapses to one entry (last value wins)", async () => {
  const ai = {
    collections: [
      {
        collectionId: "c1",
        destination: "ideias",
        columnRoles: {},
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
      {
        collectionId: "c1",
        destination: "posts",
        columnRoles: { title: "Nome" },
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "Dra. Marina" },
      },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections.length, 1);
  assertEquals(out!.collections[0].destination, "posts");
  assertEquals(out!.collections[0].clientAssignment, { mode: "fixed", clienteNome: "Dra. Marina" });
});

// Pulls the clamped summary back out of the request body handed to the fake
// fetch, so the data-minimization tests below can inspect exactly what would
// have been sent to Gemini.
function extractSentSummary(body: string): {
  collections: Array<{ collectionId: string; columns: string[]; sampleCells: Record<string, string[]> }>;
} {
  const parsedBody = JSON.parse(body);
  const text = parsedBody.contents[0].parts[0].text as string;
  const marker = "Coleções (com amostras): ";
  const line = text.split("\n").find((l: string) => l.startsWith(marker));
  assert(!!line, "prompt must include the collections line");
  return JSON.parse(line!.slice(marker.length));
}

Deno.test("refineMapping: clamps outbound sample values to at most 3 per column before calling Gemini", async () => {
  const manySamples = Array.from({ length: 25 }, (_, i) => `valor-${i}`);
  const summary = {
    collections: [
      {
        collectionId: "c1",
        name: "Clientes",
        source: "notion",
        columns: ["Nome", "Telefone"],
        listNames: [],
        rowCount: 25,
        sampleCells: { Nome: manySamples, Telefone: manySamples },
      },
    ],
  };
  const ai = {
    collections: [
      {
        collectionId: "c1",
        destination: "clientes",
        columnRoles: {},
        statusMap: {},
        clientAssignment: { mode: "fixed", clienteNome: "" },
      },
    ],
  };
  const capture: { body?: string } = {};
  await refineMapping(summary, HEURISTIC, "key", geminiOkCapturing(ai, capture));
  const sent = extractSentSummary(capture.body!);
  assertEquals(sent.collections.length, 1);
  assertEquals(sent.collections[0].sampleCells.Nome.length, 3);
  assertEquals(sent.collections[0].sampleCells.Telefone.length, 3);
  assertEquals(sent.collections[0].sampleCells.Nome, manySamples.slice(0, 3));
});

// Pulls the clamped heuristic back out of the request body handed to the fake
// fetch — mirrors extractSentSummary above, applied to the "Proposta
// heurística atual: " line instead.
function extractSentHeuristic(body: string): {
  collections: Array<{
    collectionId: string;
    destination: string;
    columnRoles: Record<string, string>;
    statusMap: Record<string, string>;
    clientAssignment: { mode: string; column?: string; clienteNome?: string };
  }>;
} {
  const parsedBody = JSON.parse(body);
  const text = parsedBody.contents[0].parts[0].text as string;
  const marker = "Proposta heurística atual: ";
  const line = text.split("\n").find((l: string) => l.startsWith(marker));
  assert(!!line, "prompt must include the heuristic line");
  return JSON.parse(line!.slice(marker.length));
}

Deno.test("refineMapping: clamps an oversized heuristic (collection count + string lengths) before calling Gemini", async () => {
  const hugeString = "x".repeat(5000);
  const manyCollections = Array.from({ length: 200 }, (_, i) => ({
    collectionId: `synthetic-${i}`,
    destination: "clientes",
    // Distinguishing prefix comes FIRST so 60 columnRoles entries stay
    // distinct keys after 200-char truncation — a huge-string PREFIX would
    // make every truncated key identical and silently collapse the map,
    // which would make the entry-count assertion below meaningless.
    columnRoles: Object.fromEntries(
      Array.from({ length: 200 }, (_, j) => [`col${j}-${hugeString}`, hugeString]),
    ),
    statusMap: Object.fromEntries(Array.from({ length: 200 }, (_, j) => [`status${j}`, hugeString])),
    clientAssignment: { mode: "fixed" as const, clienteNome: hugeString },
  }));
  const oversizedHeuristic = { collections: manyCollections };
  const capture: { body?: string } = {};
  // The AI response itself is irrelevant here (nothing in it matches any
  // known collectionId from SUMMARY, so refineMapping returns null) — the
  // test only cares about what got SENT, captured via geminiOkCapturing.
  await refineMapping(SUMMARY, oversizedHeuristic, "key", geminiOkCapturing({ collections: [] }, capture));
  const sent = extractSentHeuristic(capture.body!);

  // Collection count capped the same way summary.collections is (MAX_COLLECTIONS = 50).
  assertEquals(sent.collections.length, 50);

  const first = sent.collections[0];
  // columnRoles/statusMap entry counts capped (MAX_COLUMNS_PER_COLLECTION = 60).
  assertEquals(Object.keys(first.columnRoles).length, 60);
  assertEquals(Object.keys(first.statusMap).length, 60);

  // Every string surviving into the request body is bounded, not just truncated
  // counts — keys and values alike, plus clientAssignment's free-form field.
  for (const [k, v] of Object.entries(first.columnRoles)) {
    assert(k.length <= 200, `columnRoles key must be capped, got length ${k.length}`);
    assert(v.length <= 200, `columnRoles value must be capped, got length ${v.length}`);
  }
  for (const [k, v] of Object.entries(first.statusMap)) {
    assert(k.length <= 200, `statusMap key must be capped, got length ${k.length}`);
    assert(v.length <= 200, `statusMap value must be capped, got length ${v.length}`);
  }
  assert(first.clientAssignment.clienteNome!.length <= 200, "clientAssignment.clienteNome must be capped");

  // The overall request body itself must stay bounded — this is the actual
  // budget/DoS concern, not just each individual field in isolation. The
  // theoretical ceiling implied by the caps is on the order of
  // 50 collections * 60 entries * 2 maps * 2 (key+value) * 200 chars ≈ 2.4M
  // characters, plus JSON punctuation/escaping overhead; 5MB is a generous
  // margin above that ceiling while still being tiny next to what the
  // UNCLAMPED input here would have produced (200 collections * 200 entries
  // * 2 maps * 2 * 5000-char strings ≈ hundreds of megabytes).
  assert(capture.body!.length < 5_000_000, `request body must stay bounded, got ${capture.body!.length} bytes`);
});

Deno.test("refineMapping: a malformed (non-array collections) heuristic degrades to an empty proposal, not a crash", async () => {
  const capture: { body?: string } = {};
  const malformedHeuristic = { collections: "not-an-array" } as unknown as {
    collections: unknown[];
  };
  await refineMapping(SUMMARY, malformedHeuristic as any, "key", geminiOkCapturing({ collections: [] }, capture));
  const sent = extractSentHeuristic(capture.body!);
  assertEquals(sent.collections, []);
});

Deno.test("refineMapping: clamps outbound collection and column counts before calling Gemini", async () => {
  const manyCollections = Array.from({ length: 80 }, (_, i) => ({
    collectionId: `c${i}`,
    name: `Coleção ${i}`,
    source: "clickup",
    columns: Array.from({ length: 90 }, (_, j) => `Col${j}`),
    listNames: [],
    rowCount: 1,
    sampleCells: Object.fromEntries(Array.from({ length: 90 }, (_, j) => [`Col${j}`, ["v"]])),
  }));
  const summary = { collections: manyCollections };
  const capture: { body?: string } = {};
  await refineMapping(summary, HEURISTIC, "key", geminiOkCapturing({ collections: [] }, capture));
  const sent = extractSentSummary(capture.body!);
  assertEquals(sent.collections.length, 50);
  assertEquals(sent.collections[0].columns.length, 60);
  assertEquals(Object.keys(sent.collections[0].sampleCells).length, 60);
});

Deno.test("refineMapping: truncates an oversized sample value so the request body stays bounded", async () => {
  // Counting samples bounded HOW MANY values crossed the boundary to Google
  // but nothing about their size: one Notion caption or spreadsheet cell can
  // be megabytes on its own, and 3-of-those is still megabytes of third-party
  // personal data in the request.
  const hugeValue = "x".repeat(2_000_000);
  const summary = {
    collections: [
      {
        collectionId: "c1",
        name: "N".repeat(5000),
        source: "notion",
        columns: ["Legenda", "C".repeat(5000)],
        listNames: ["L".repeat(5000)],
        rowCount: 1,
        sampleCells: { Legenda: [hugeValue], ["C".repeat(5000)]: [hugeValue] },
      },
    ],
  };
  const capture: { body?: string } = {};
  await refineMapping(summary, HEURISTIC, "key", geminiOkCapturing({ collections: [] }, capture));
  const sent = extractSentSummary(capture.body!);

  for (const values of Object.values(sent.collections[0].sampleCells)) {
    for (const v of values) {
      assert(v.length <= 200, `sample value must be truncated, got length ${v.length}`);
    }
  }
  for (const col of sent.collections[0].columns) {
    assert(col.length <= 200, `column name must be truncated, got length ${col.length}`);
  }
  for (const key of Object.keys(sent.collections[0].sampleCells)) {
    assert(key.length <= 200, `sampleCells key must be truncated, got length ${key.length}`);
  }

  // The raw value must not appear anywhere in what leaves this process, and
  // the whole body must stay small — 4MB of input collapses to a few KB.
  assert(!capture.body!.includes(hugeValue), "the full sample value must never be sent");
  assert(capture.body!.length < 100_000, `request body must stay bounded, got ${capture.body!.length} bytes`);
});
