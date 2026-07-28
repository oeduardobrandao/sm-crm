// Optional Gemini refinement of the deterministic heuristic mapping proposal
// produced client-side by packages/import-parsers. This module is an
// ENHANCEMENT, never a dependency: the wizard already works fully off the
// heuristic proposal, the user confirms every field regardless, and any
// failure here (missing key, network/HTTP failure, malformed body, wrong
// shape, hostile content) must degrade to "keep the heuristic proposal" —
// i.e. return null — never throw and never surface a broken wizard.
//
// The model's response is treated as UNTRUSTED INPUT because it is merged
// into a structure that later drives database writes (via the commit RPC).
// Two rules enforced here, independent of anything the RPC re-checks itself
// (defence in depth, not the only line):
//   - every collectionId in the AI answer must already exist in the summary
//     we sent it — an unknown id is dropped, never invented into the proposal.
//   - every statusMap value must be in STATUS_TARGETS. In particular
//     "agendado" is never in that allow-list: the Instagram/TikTok publish
//     crons poll workflow_posts.status = 'agendado', so a model-invented
//     "agendado" must never reach a proposal a human could confirm through.
//     Any value outside the allow-list is clamped to "rascunho", not dropped
//     silently — the column still gets a status, just the safe one.
//
// The outbound side gets the same defence in depth applied to BOTH values
// embedded into the prompt:
//   - clampSummaryForRequest (below) caps sample values per column, columns
//     per collection, and the number of collections in the server-derived
//     summary before it is serialized into the Gemini request body, so the
//     request never carries more than column headers plus a few sample
//     values per column — never the full roster — regardless of what the
//     caller (packages/import-parsers, via the future import wizard)
//     actually sends.
//   - clampHeuristicForRequest (below) applies the same collection-count cap,
//     plus a per-string length cap, to `heuristic` — the client-supplied
//     mapping proposal. heuristic carries no sample cell values (so it is not
//     the data-leak concern the summary is), but /analyze accepts arbitrary
//     JSON from any authenticated member of an entitled workspace, and
//     buildPrompt serializes it wholesale via JSON.stringify — an oversized or
//     hostile heuristic (thousands of synthetic collections, huge strings as
//     columnRoles/statusMap keys) would otherwise inflate every Gemini
//     request unbounded, with no cap and no rate limit on repeated calls.
import type { AnalyzeSummary, WireCollectionMapping, WireMappingProposal } from "../data-import/types.ts";

const DESTINATIONS = new Set(["clientes", "posts", "entregas", "ideias", "ignorar"]);

// Mirrors IMPORTABLE_POST_STATUSES in data-import/handler.ts (and the RPC's
// own allow-list in 20260727000001_data_import_jobs.sql). 'agendado' and
// 'falha_publicacao' are deliberately absent — see the module comment above.
const STATUS_TARGETS = new Set([
  "rascunho",
  "revisao_interna",
  "aprovado_interno",
  "enviado_cliente",
  "aprovado_cliente",
  "correcao_cliente",
  "postado",
]);

// Outbound data-minimization caps. The caller (packages/import-parsers,
// exercised through the future import wizard) is documented to already send
// only headers + a few sample values, but that caller doesn't exist yet as
// of this module's introduction — so the guarantee this module's original
// comment asserted was 100% trust in code that hadn't been written. These
// caps make the guarantee real regardless of what any future or hostile
// caller sends, mirroring the defence-in-depth already applied to the
// inbound `destination`/`statusMap` values above.
const MAX_COLLECTIONS = 50;
const MAX_COLUMNS_PER_COLLECTION = 60;
const MAX_SAMPLES_PER_COLUMN = 3;
// heuristic.collections has no natural per-field cap the way the summary's
// sample counts do — its columnRoles/statusMap/clientAssignment values are
// free-form strings a hostile caller could inflate arbitrarily. This bounds
// any single string embedded into the prompt from the heuristic proposal.
const MAX_HEURISTIC_STRING_LENGTH = 200;

/**
 * Clamps the collection/column/sample-value counts before the summary is
 * embedded into the Gemini request body. This — not caller discipline — is
 * what enforces "column headers plus at most a few sample values per
 * column, never the full roster": client names, emails, phone numbers, and
 * other per-row values living in `sampleCells` are third-party personal
 * data belonging to the agency's clients, and this request leaves the
 * process boundary to Google.
 */
function clampSummaryForRequest(summary: AnalyzeSummary): AnalyzeSummary {
  const collections = summary.collections.slice(0, MAX_COLLECTIONS).map((c) => {
    const columns = c.columns.slice(0, MAX_COLUMNS_PER_COLLECTION);
    const sampleCells: Record<string, string[]> = {};
    for (const [col, values] of Object.entries(c.sampleCells).slice(0, MAX_COLUMNS_PER_COLLECTION)) {
      sampleCells[col] = (Array.isArray(values) ? values : []).slice(0, MAX_SAMPLES_PER_COLUMN);
    }
    return { ...c, columns, sampleCells };
  });
  return { collections };
}

function clampHeuristicString(value: unknown): string {
  const s = typeof value === "string" ? value : "";
  return s.length > MAX_HEURISTIC_STRING_LENGTH ? s.slice(0, MAX_HEURISTIC_STRING_LENGTH) : s;
}

/** Caps both the number of entries and the length of every key/value string. */
function clampHeuristicStringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_COLUMNS_PER_COLLECTION)) {
    out[clampHeuristicString(k)] = clampHeuristicString(v);
  }
  return out;
}

function clampHeuristicClientAssignment(value: unknown): WireCollectionMapping["clientAssignment"] {
  const mode = (value as { mode?: unknown } | null | undefined)?.mode;
  if (mode === "column") {
    return { mode: "column", column: clampHeuristicString((value as { column?: unknown }).column) };
  }
  const clienteNome = (value as { clienteNome?: unknown } | null | undefined)?.clienteNome;
  return { mode: "fixed", clienteNome: clampHeuristicString(clienteNome) };
}

/**
 * Clamps the client-supplied heuristic mapping proposal before it is embedded
 * into the Gemini request body — the same data-minimization discipline
 * clampSummaryForRequest applies to the server-derived summary, adapted to
 * heuristic's shape: a bounded number of collections, each with bounded
 * columnRoles/statusMap maps and length-capped strings throughout. Tolerant
 * of a malformed (non-array/non-object) heuristic — refineMapping's own
 * try/catch still covers anything this cannot make sense of, but a merely
 * oversized-and-well-shaped payload is the case this function exists to cap.
 */
function clampHeuristicForRequest(heuristic: WireMappingProposal): WireMappingProposal {
  const rawCollections = Array.isArray(heuristic?.collections) ? heuristic.collections : [];
  const collections = rawCollections.slice(0, MAX_COLLECTIONS).map(
    (c): WireCollectionMapping => ({
      collectionId: clampHeuristicString((c as { collectionId?: unknown })?.collectionId),
      destination: clampHeuristicString(
        (c as { destination?: unknown })?.destination,
      ) as WireCollectionMapping["destination"],
      columnRoles: clampHeuristicStringMap((c as { columnRoles?: unknown })?.columnRoles),
      statusMap: clampHeuristicStringMap((c as { statusMap?: unknown })?.statusMap),
      clientAssignment: clampHeuristicClientAssignment((c as { clientAssignment?: unknown })?.clientAssignment),
    }),
  );
  return { collections };
}

function buildPrompt(summary: AnalyzeSummary, heuristic: WireMappingProposal): string {
  return [
    "Você mapeia dados exportados de ferramentas de gestão (Trello/Notion/ClickUp) para um CRM de social media.",
    "Destinos possíveis por coleção: clientes | posts | entregas | ideias | ignorar.",
    "Papéis de coluna possíveis: title, date, status, client, caption, email, phone, monthlyValue, specialty, tipo, url.",
    `Status de post permitidos: ${[...STATUS_TARGETS].join(", ")}. NUNCA use "agendado".`,
    "Responda APENAS com JSON no mesmo formato da proposta heurística, sem markdown.",
    `Coleções (com amostras): ${JSON.stringify(summary)}`,
    `Proposta heurística atual: ${JSON.stringify(heuristic)}`,
  ].join("\n");
}

/** Only string values survive — a hostile/odd response cannot smuggle non-string role values into the merged proposal. */
function sanitizeColumnRoles(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function sanitizeStatusMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = typeof v === "string" && STATUS_TARGETS.has(v) ? v : "rascunho";
  }
  return out;
}

function sanitizeClientAssignment(value: unknown): WireCollectionMapping["clientAssignment"] {
  const mode = (value as { mode?: unknown } | null | undefined)?.mode;
  if (mode === "column") {
    const column = (value as { column?: unknown }).column;
    if (typeof column === "string") return { mode: "column", column };
  }
  const clienteNome = (value as { clienteNome?: unknown } | null | undefined)?.clienteNome;
  return { mode: "fixed", clienteNome: typeof clienteNome === "string" ? clienteNome : "" };
}

/**
 * Sends the parsed-collection summary (headers + at most MAX_SAMPLES_PER_COLUMN
 * sample values per column, clamped by clampSummaryForRequest — never the
 * full roster) plus the heuristic proposal to Gemini, and returns a
 * validated replacement proposal — or null on ANY failure, so the caller
 * always has a safe fallback (the heuristic it already has).
 */
export async function refineMapping(
  summary: AnalyzeSummary,
  heuristic: WireMappingProposal,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<WireMappingProposal | null> {
  try {
    const clampedSummary = clampSummaryForRequest(summary);
    const clampedHeuristic = clampHeuristicForRequest(heuristic);
    const res = await fetchFn(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(clampedSummary, clampedHeuristic) }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) return null;

    const data = await res.json();
    const text = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> })
      ?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    const rawCollections = (parsed as { collections?: unknown })?.collections;
    if (!Array.isArray(rawCollections)) return null;

    const knownIds = new Set(clampedSummary.collections.map((c) => c.collectionId));
    // Keyed by collectionId, not pushed to an array: a response with two
    // entries for the same collectionId (malformed or adversarial) would
    // otherwise both survive into the proposal, and downstream code that
    // expects one mapping per collection would silently see the wrong one
    // depending on iteration order. Map.set on a repeated key keeps the
    // first entry's position but the LAST entry's content — deliberate
    // last-value-wins, applied consistently with how sanitizeColumnRoles/
    // sanitizeStatusMap already resolve repeated keys within one object.
    const collectionsById = new Map<string, WireCollectionMapping>();
    for (const c of rawCollections as Array<Record<string, unknown>>) {
      const collectionId = c?.collectionId;
      const destination = c?.destination;
      if (typeof collectionId !== "string" || !knownIds.has(collectionId)) continue;
      if (typeof destination !== "string" || !DESTINATIONS.has(destination)) continue;
      collectionsById.set(collectionId, {
        collectionId,
        destination: destination as WireCollectionMapping["destination"],
        columnRoles: sanitizeColumnRoles(c?.columnRoles),
        statusMap: sanitizeStatusMap(c?.statusMap),
        clientAssignment: sanitizeClientAssignment(c?.clientAssignment),
      });
    }
    const collections = [...collectionsById.values()];
    return collections.length ? { collections } : null;
  } catch {
    return null;
  }
}
