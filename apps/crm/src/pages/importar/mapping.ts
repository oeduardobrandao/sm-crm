// Pure helpers around the mapping proposal: what we send the AI, and how its
// answer is merged back into the deterministic heuristic proposal.
import {
  POST_STATUS_TARGETS,
  type CollectionMapping,
  type Destination,
  type ImportBundle,
  type MappingProposal,
  type PostStatusTarget,
} from '@mesaas/import-parsers';
import type { AnalyzeSummary } from '@/services/dataImport';

const MAX_SAMPLES_PER_COLUMN = 3;

const DESTINATIONS: readonly Destination[] = ['clientes', 'posts', 'entregas', 'ideias', 'ignorar'];

/**
 * DATA MINIMIZATION: headers, list names and at most three sample values per
 * column — never the full roster. Client names and contacts are third-party
 * PII and must not be shipped wholesale to the model.
 */
export function summarizeBundle(bundle: ImportBundle): AnalyzeSummary {
  return {
    collections: bundle.collections.map((c) => {
      const sampleCells: Record<string, string[]> = {};
      for (const column of c.columns) {
        const samples: string[] = [];
        for (const row of c.rows) {
          const value = (row.cells[column] ?? '').trim();
          if (value && !samples.includes(value)) samples.push(value);
          if (samples.length >= MAX_SAMPLES_PER_COLUMN) break;
        }
        sampleCells[column] = samples;
      }
      return {
        collectionId: c.id,
        name: c.name,
        source: c.source,
        columns: c.columns,
        listNames: c.listNames,
        rowCount: c.rows.length,
        sampleCells,
      };
    }),
  };
}

function isStatusTarget(value: unknown): value is PostStatusTarget {
  return typeof value === 'string' && (POST_STATUS_TARGETS as readonly string[]).includes(value);
}

/**
 * Merges the edge function's refined proposal over the heuristic one, per
 * collection. The AI is an enhancement: anything it did not answer for — or
 * answered with a value we do not recognize — keeps the heuristic's version.
 * The server already validates the payload; this re-validates because the
 * heuristic proposal is what the user's form is bound to.
 */
export function mergeAiProposal(heuristic: MappingProposal, ai: unknown): MappingProposal {
  const refined = (ai as { collections?: unknown })?.collections;
  if (!Array.isArray(refined)) return heuristic;
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of refined as Record<string, unknown>[]) {
    const id = entry?.collectionId;
    if (typeof id === 'string') byId.set(id, entry);
  }
  return {
    collections: heuristic.collections.map((mapping): CollectionMapping => {
      const entry = byId.get(mapping.collectionId);
      if (!entry) return mapping;
      const destination = DESTINATIONS.includes(entry.destination as Destination)
        ? (entry.destination as Destination)
        : mapping.destination;
      const statusMap = { ...mapping.statusMap };
      if (entry.statusMap && typeof entry.statusMap === 'object') {
        for (const [key, value] of Object.entries(entry.statusMap as Record<string, unknown>)) {
          if (isStatusTarget(value)) statusMap[key] = value;
        }
      }
      const assignment = entry.clientAssignment as
        | CollectionMapping['clientAssignment']
        | undefined;
      const clientAssignment =
        assignment?.mode === 'column' && typeof assignment.column === 'string'
          ? assignment
          : assignment?.mode === 'fixed' && typeof assignment.clienteNome === 'string'
            ? assignment
            : mapping.clientAssignment;
      return {
        ...mapping,
        destination,
        columnRoles:
          entry.columnRoles && typeof entry.columnRoles === 'object'
            ? { ...mapping.columnRoles, ...(entry.columnRoles as CollectionMapping['columnRoles']) }
            : mapping.columnRoles,
        statusMap,
        clientAssignment,
      };
    }),
  };
}
