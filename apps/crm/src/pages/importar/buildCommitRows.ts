// The heart of import correctness: the pure transformation from a confirmed
// mapping to the wire rows the `data-import` edge function commits.
//
// Pure and React-free on purpose — every rule below (container chunking, client
// resolution, the status/date clamp, commit ordering) is unit-tested in
// __tests__/buildCommitRows.test.ts.
import {
  POST_STATUS_TARGETS,
  toTipTapDoc,
  type CollectionMapping,
  type ImportBundle,
  type ImportCollection,
  type ImportRow,
  type MappingProposal,
} from '@mesaas/import-parsers';
import type {
  ClienteRef,
  CommitClienteRow,
  CommitContainerRow,
  CommitEntregaRow,
  CommitIdeiaRow,
  CommitPostRow,
  CommitRow,
  CommitTemplateRow,
  Provenance,
} from '@/services/dataImport';

export interface ExistingCliente {
  id: number;
  nome: string;
}

const SOURCE_LABELS: Record<string, string> = {
  trello: 'Trello',
  notion: 'Notion',
  clickup: 'ClickUp',
  csv: 'planilha',
};

type PostTipo = 'feed' | 'reels' | 'stories' | 'carrossel';

/**
 * Case-, accent- and whitespace-insensitive key for matching client names.
 * Exported so every place that needs to answer "is this the same client as
 * that roster row" (the mapping-step hint included) uses the one definition \u2014
 * two normalizations of the same concept only ever drift apart.
 */
export function norm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cell(row: ImportRow, column: string | undefined): string {
  return column ? (row.cells[column] ?? '').trim() : '';
}

/**
 * pt-BR ("1.200,50") and en ("1,200.75") thousand/decimal separators.
 *
 * When BOTH a comma and a dot are present, whichever comes last is the decimal
 * mark and the other is a thousands separator (stripped entirely).
 *
 * When only ONE separator type is present, it's ambiguous — pt-BR sheets
 * routinely omit cents, so "1.200" means 1200, not 1.2. The rule: if the LAST
 * (and, for a lone separator, only) occurrence is followed by exactly three
 * digits and nothing else, every occurrence of that separator is a thousands
 * mark and gets stripped ("1.500" -> 1500, "1.234.567" -> 1234567). Otherwise —
 * one or two trailing digits, an explicit decimal part — only the last
 * occurrence is treated as the decimal point ("1.50" -> 1.5, "12.5" -> 12.5).
 *
 * Returns undefined when nothing numeric remains.
 */
function parseValor(raw: string): number | undefined {
  const cleaned = raw.replace(/[^\d,.-]/g, '');
  if (!/\d/.test(cleaned)) return undefined;

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;

  if (lastComma !== -1 && lastDot !== -1) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? ',' : '.';
    const sepPattern = sep === '.' ? /\./g : /,/g;
    const lastIndex = Math.max(lastComma, lastDot);
    const after = cleaned.slice(lastIndex + 1);
    normalized = /^\d{3}$/.test(after)
      ? cleaned.replace(sepPattern, '')
      : `${cleaned.slice(0, lastIndex).replace(sepPattern, '')}.${after}`;
  }

  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * ISO first (what every parser emits for first-class dates), then dd/mm/yyyy —
 * the shape a Brazilian spreadsheet exports, which `Date.parse` reads as
 * mm/dd/yyyy or rejects outright.
 *
 * CALENDAR VALIDATION: the `Date` constructor NORMALIZES out-of-range
 * components instead of failing — `new Date(2026, 1, 31)` is 3 March 2026, and
 * `new Date(2026, 12, 1)` is January 2027. Left unchecked, a cell reading
 * "31/02/2026" would silently schedule a post or an entrega on a day the user
 * never wrote. Reading the components back off the constructed date is the only
 * way to tell a real date from a normalized one; a mismatch means the cell was
 * never a valid date, so it takes the same path as any other garbage input
 * (null — the caller treats a dateless row as unscheduled).
 */
function parseDate(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const br = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const d = new Date(year, month - 1, day, 12, 0, 0);
    if (
      Number.isNaN(d.getTime()) ||
      d.getFullYear() !== year ||
      d.getMonth() !== month - 1 ||
      d.getDate() !== day
    ) {
      return null;
    }
    return d.toISOString();
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseTipo(raw: string): PostTipo {
  const v = norm(raw);
  if (!v) return 'feed';
  if (v.includes('carrossel') || v.includes('carousel')) return 'carrossel';
  if (v.includes('stor')) return 'stories';
  if (v.includes('reel') || v.includes('video')) return 'reels';
  if (v.includes('feed')) return 'feed';
  return 'feed';
}

/** Post body: the source's long-form text, then its checklist as bullets. */
function postBody(row: ImportRow, mapping: CollectionMapping): string {
  const base = (row.description ?? '').trim() || cell(row, mapping.columnRoles.caption);
  const bullets = (row.checklist ?? []).filter((i) => i.trim()).map((i) => `- ${i.trim()}`);
  return [base, ...bullets].filter(Boolean).join('\n');
}

function provenanceOf(collection: ImportCollection, row: ImportRow): Provenance {
  return {
    source: collection.source,
    collectionId: collection.id,
    sourceKey: row.key,
    sourceUrl: row.sourceUrl?.trim() ? row.sourceUrl : null,
    cells: row.cells,
  };
}

function titleOf(row: ImportRow, collection: ImportCollection, mapping: CollectionMapping): string {
  return cell(row, mapping.columnRoles.title) || cell(row, collection.columns[0]);
}

/** Opaque, collision-free grouping key for a resolved client. */
function clienteKey(ref: ClienteRef): string {
  return ref.type === 'existing' ? `existing-${ref.clienteId}` : `created-${ref.sourceKey}`;
}

function chunk<T>(items: T[], size: number | null): T[][] {
  if (size == null || size <= 0 || items.length <= size) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Confirmed mapping -> wire rows, pre-sorted in COMMIT ORDER
 * (clientes -> templates -> containers -> posts/entregas/ideias), because the
 * server resolves `clienteRef`, `templateKey` and `containerKey` against rows
 * committed by an EARLIER batch of the same job.
 *
 * `maxPostsPerWorkflow` is the only non-deterministic input: pass `null` for the
 * preview call (chunking off, so preview counts a client's posts under one
 * container and can warn about the cap), then the plan's real cap for the
 * commit call.
 */
export function buildCommitRows(
  bundle: ImportBundle,
  proposal: MappingProposal,
  existingClientes: ExistingCliente[],
  maxPostsPerWorkflow: number | null,
): CommitRow[] {
  const mappings = new Map(proposal.collections.map((m) => [m.collectionId, m]));

  const existingByName = new Map<string, number>();
  for (const c of existingClientes) {
    const key = norm(c.nome ?? '');
    if (key && !existingByName.has(key)) existingByName.set(key, c.id);
  }

  const clienteRows: CommitClienteRow[] = [];
  const autoClienteRows: CommitClienteRow[] = [];
  const templateRows: CommitTemplateRow[] = [];
  const containerRows: CommitContainerRow[] = [];
  const rest: CommitRow[] = [];

  /** normalized name -> the ref every later row must point at. */
  const refByName = new Map<string, ClienteRef>();

  // --- 1. roster collections -------------------------------------------------
  for (const collection of bundle.collections) {
    const mapping = mappings.get(collection.id);
    if (mapping?.destination !== 'clientes') continue;
    for (const row of collection.rows) {
      const nome = titleOf(row, collection, mapping);
      // clientes.nome is NOT NULL and the RPC raises on a blank one: a nameless
      // roster row (a trailing blank spreadsheet line) is dropped here rather
      // than sent to fail.
      if (!nome) continue;
      const key = norm(nome);
      const mergeId = existingByName.get(key);
      const valor = parseValor(cell(row, mapping.columnRoles.monthlyValue));
      const cliente: CommitClienteRow = {
        kind: 'cliente',
        sourceKey: row.key,
        nome,
        ...(cell(row, mapping.columnRoles.email) && {
          email: cell(row, mapping.columnRoles.email),
        }),
        ...(cell(row, mapping.columnRoles.phone) && {
          telefone: cell(row, mapping.columnRoles.phone),
        }),
        ...(cell(row, mapping.columnRoles.specialty) && {
          especialidade: cell(row, mapping.columnRoles.specialty),
        }),
        ...(valor !== undefined && { valorMensal: valor }),
        ...(cell(row, mapping.columnRoles.url) && {
          notionPageUrl: cell(row, mapping.columnRoles.url),
        }),
        ...(mergeId !== undefined && { merge: { clienteId: mergeId } }),
        provenance: provenanceOf(collection, row),
      };
      clienteRows.push(cliente);
      if (!refByName.has(key)) {
        refByName.set(
          key,
          mergeId !== undefined
            ? { type: 'existing', clienteId: mergeId }
            : { type: 'created', sourceKey: row.key },
        );
      }
    }
  }

  /**
   * A client name referenced by a post/entrega/ideia row resolves, in order, to:
   * a cliente this job already emits, an existing workspace cliente, or a newly
   * synthesized one. Blank names cannot resolve — the wizard blocks advancing
   * with an unassigned collection, and rows that still carry one are dropped.
   */
  function resolveRef(rawName: string): ClienteRef | null {
    const key = norm(rawName ?? '');
    if (!key) return null;
    const known = refByName.get(key);
    if (known) return known;
    const existing = existingByName.get(key);
    const ref: ClienteRef =
      existing !== undefined
        ? { type: 'existing', clienteId: existing }
        : { type: 'created', sourceKey: `auto-cliente:${rawName.trim()}` };
    if (ref.type === 'created') {
      autoClienteRows.push({ kind: 'cliente', sourceKey: ref.sourceKey, nome: rawName.trim() });
    }
    refByName.set(key, ref);
    return ref;
  }

  function rowClientName(row: ImportRow, mapping: CollectionMapping): string {
    return mapping.clientAssignment.mode === 'fixed'
      ? mapping.clientAssignment.clienteNome
      : (row.cells[mapping.clientAssignment.column] ?? '');
  }

  // Container numbering runs PER CLIENT across the whole job, so two posts
  // collections assigned to the same client can never mint the same key.
  const containerCount = new Map<string, number>();

  // --- 2. content collections ------------------------------------------------
  for (const collection of bundle.collections) {
    const mapping = mappings.get(collection.id);
    if (!mapping || mapping.destination === 'clientes' || mapping.destination === 'ignorar') {
      continue;
    }

    if (mapping.destination === 'posts') {
      // Group first, chunk second: a container has to know its group size.
      const groups = new Map<string, { ref: ClienteRef; rows: ImportRow[] }>();
      for (const row of collection.rows) {
        const ref = resolveRef(rowClientName(row, mapping));
        if (!ref) continue;
        const key = clienteKey(ref);
        const group = groups.get(key) ?? { ref, rows: [] };
        group.rows.push(row);
        groups.set(key, group);
      }
      for (const [key, group] of groups) {
        const parts = chunk(group.rows, maxPostsPerWorkflow);
        parts.forEach((part, partIndex) => {
          // `n` only guarantees a collision-free key across the whole job (it
          // runs per client across collections). The "(n)" TITLE suffix must
          // instead reflect this collection's OWN chunk index — otherwise two
          // single-chunk collections for the same client render "jan" then
          // "fev (2)", a "(2)" with no "(1)".
          const n = containerCount.get(key) ?? 0;
          containerCount.set(key, n + 1);
          const containerKey = `container:${key}:${n}`;
          containerRows.push({
            kind: 'container',
            sourceKey: containerKey,
            clienteRef: group.ref,
            titulo: `Calendário importado — ${collection.name}${partIndex > 0 ? ` (${partIndex + 1})` : ''}`,
          });
          for (const row of part) rest.push(postRow(row, collection, mapping, containerKey));
        });
      }
      continue;
    }

    if (mapping.destination === 'entregas') {
      // A listless board still needs one etapa: `etapa_atual` 0 must exist.
      const etapas = collection.listNames.length ? collection.listNames : ['Importado'];
      const templateKey = `template:${collection.id}`;
      const label = SOURCE_LABELS[collection.source] ?? collection.source;
      templateRows.push({
        kind: 'template',
        sourceKey: templateKey,
        nome: `Importado do ${label} — ${collection.name}`,
        etapas,
      });
      for (const row of collection.rows) {
        const ref = resolveRef(rowClientName(row, mapping));
        if (!ref) continue;
        const idx = row.listName ? etapas.indexOf(row.listName) : -1;
        const entrega: CommitEntregaRow = {
          kind: 'entrega',
          sourceKey: row.key,
          templateKey,
          clienteRef: ref,
          titulo: titleOf(row, collection, mapping),
          etapaIndex: idx >= 0 ? idx : 0,
          dueDate: row.dueDate ?? parseDate(cell(row, mapping.columnRoles.date)),
          provenance: provenanceOf(collection, row),
        };
        rest.push(entrega);
      }
      continue;
    }

    // ideias
    for (const row of collection.rows) {
      const ref = resolveRef(rowClientName(row, mapping));
      if (!ref) continue;
      const titulo = titleOf(row, collection, mapping);
      const titleColumn = mapping.columnRoles.title ?? collection.columns[0];
      const fallback = collection.columns
        .filter((c) => c !== titleColumn && (row.cells[c] ?? '').trim())
        .map((c) => `${c}: ${row.cells[c].trim()}`)
        .join('\n');
      const ideia: CommitIdeiaRow = {
        kind: 'ideia',
        sourceKey: row.key,
        clienteRef: ref,
        titulo,
        descricao: (row.description ?? '').trim() || fallback,
        provenance: provenanceOf(collection, row),
      };
      rest.push(ideia);
    }
  }

  return [...clienteRows, ...autoClienteRows, ...templateRows, ...containerRows, ...rest];
}

/**
 * STATUS/DATE CLAMP (client half). The RPC re-derives all of this server-side
 * and is authoritative — this mirror exists so the preview the user confirms
 * shows what will actually land, and so a bug here can never be the thing that
 * schedules an imported post for publication.
 *
 * INVARIANT: `publishedAt` is non-null only when status is 'postado', and
 * 'postado' requires a date in the past.
 */
function postRow(
  row: ImportRow,
  collection: ImportCollection,
  mapping: CollectionMapping,
  containerKey: string,
): CommitPostRow {
  const statusKey = row.listName ?? cell(row, mapping.columnRoles.status);
  const mapped = statusKey ? mapping.statusMap[statusKey] : undefined;
  // Defence in depth against a hand-edited or AI-refined proposal: anything
  // outside the importable set (notably 'agendado', which the publish crons
  // claim) degrades to 'rascunho'.
  let status: string =
    mapped && (POST_STATUS_TARGETS as readonly string[]).includes(mapped) ? mapped : 'rascunho';

  const date = row.dueDate ?? parseDate(cell(row, mapping.columnRoles.date));
  let scheduledAt: string | null = date;
  let publishedAt: string | null = null;
  if (status === 'postado') {
    if (!date) {
      // Dateless rows import as unscheduled rascunho: 'postado' with no date
      // would claim the post is live with nothing to show for it.
      status = 'rascunho';
    } else if (Date.parse(date) > Date.now()) {
      status = 'aprovado_cliente'; // future-dated: not published, just planned
    } else {
      scheduledAt = null;
      publishedAt = date;
    }
  }

  const { doc, plain } = toTipTapDoc(postBody(row, mapping));
  return {
    kind: 'post',
    sourceKey: row.key,
    containerKey,
    titulo: titleOf(row, collection, mapping),
    conteudo: doc,
    conteudoPlain: plain,
    tipo: parseTipo(cell(row, mapping.columnRoles.tipo)),
    status,
    scheduledAt,
    publishedAt,
    provenance: provenanceOf(collection, row),
  };
}
