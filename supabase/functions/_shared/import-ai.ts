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
 * Sends the parsed-collection summary (headers + a few sample values, never
 * the full roster) plus the heuristic proposal to Gemini, and returns a
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
    const res = await fetchFn(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(summary, heuristic) }] }],
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

    const knownIds = new Set(summary.collections.map((c) => c.collectionId));
    const collections: WireCollectionMapping[] = [];
    for (const c of rawCollections as Array<Record<string, unknown>>) {
      const collectionId = c?.collectionId;
      const destination = c?.destination;
      if (typeof collectionId !== "string" || !knownIds.has(collectionId)) continue;
      if (typeof destination !== "string" || !DESTINATIONS.has(destination)) continue;
      collections.push({
        collectionId,
        destination: destination as WireCollectionMapping["destination"],
        columnRoles: sanitizeColumnRoles(c?.columnRoles),
        statusMap: sanitizeStatusMap(c?.statusMap),
        clientAssignment: sanitizeClientAssignment(c?.clientAssignment),
      });
    }
    return collections.length ? { collections } : null;
  } catch {
    return null;
  }
}
