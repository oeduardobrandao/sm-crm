import type {
  CollectionMapping,
  ColumnRoles,
  ImportBundle,
  ImportCollection,
  MappingProposal,
  PostStatusTarget,
} from './types';

const ROLE_PATTERNS: [keyof ColumnRoles, RegExp][] = [
  ['title', /^(nome|name|task ?name|t[ií]tulo)$/i],
  ['date', /data|date|publica|agendad/i],
  ['status', /status|fase|etapa/i],
  ['client', /cliente|client|marca|conta|etiquetas/i],
  ['caption', /legenda|caption|texto|conte[uú]do/i],
  ['email', /e-?mail/i],
  ['phone', /telefone|phone|celular|whats/i],
  ['monthlyValue', /valor|mensalidade|fee/i],
  ['specialty', /especialidade|specialty/i],
  ['tipo', /tipo|formato|format/i],
  ['url', /^(url|link)$/i],
];

export function mapStatus(source: string): PostStatusTarget {
  const s = source.toLowerCase();
  if (/aprovad/.test(s)) return 'aprovado_cliente';
  if (/revis|review/.test(s)) return 'revisao_interna';
  if (/corre/.test(s)) return 'correcao_cliente';
  if (/enviado|client/.test(s)) return 'enviado_cliente';
  if (/postado|publicado|published|done|conclu/.test(s)) return 'postado';
  if (/agendad|sched/.test(s)) return 'aprovado_cliente'; // clamp: never 'agendado'
  return 'rascunho';
}

/**
 * A detected client column only becomes the proposal when it actually carries
 * data. Trello exports match 'Etiquetas' as the client column, but a board
 * that never labels its cards yields an all-blank column — and binding the
 * client to it makes every row resolve to a blank client, so the whole import
 * commits nothing. Requiring a client name on at least half the rows keeps
 * the real cases (roster CSVs, label-per-client boards) on column mode and
 * sends sparse or empty columns to the fixed picker, which blocks the wizard
 * until the user names the client.
 */
const CLIENT_COLUMN_MIN_DENSITY = 0.5;

function clientColumnDense(col: ImportCollection, column: string): boolean {
  if (col.rows.length === 0) return false;
  const filled = col.rows.filter((r) => (r.cells[column] ?? '').trim()).length;
  return filled / col.rows.length >= CLIENT_COLUMN_MIN_DENSITY;
}

function columnRoles(col: ImportCollection): ColumnRoles {
  const roles: ColumnRoles = {};
  for (const header of col.columns) {
    for (const [role, re] of ROLE_PATTERNS) {
      if (!roles[role] && re.test(header)) {
        roles[role] = header;
        break;
      }
    }
  }
  return roles;
}

function classify(col: ImportCollection, roles: ColumnRoles): CollectionMapping['destination'] {
  const dateDensity =
    col.rows.length === 0
      ? 0
      : col.rows.filter((r) => r.dueDate || (roles.date && r.cells[roles.date])).length /
        col.rows.length;
  if (/client|roster/i.test(col.name) || (roles.email && roles.phone)) return 'clientes';
  if (/ideia|idea|backlog|banco/i.test(col.name)) return 'ideias';
  if (col.listNames.length > 0 && dateDensity < 0.3) return 'entregas';
  if (roles.date || dateDensity >= 0.3) return 'posts';
  return 'ideias';
}

export function proposeMapping(bundle: ImportBundle): MappingProposal {
  const collections = bundle.collections.map((col): CollectionMapping => {
    const roles = columnRoles(col);
    const destination = classify(col, roles);
    const clientColumn = roles.client && clientColumnDense(col, roles.client) ? roles.client : null;
    const statusValues =
      col.listNames.length > 0
        ? col.listNames
        : roles.status
          ? [...new Set(col.rows.map((r) => r.cells[roles.status!]).filter(Boolean))]
          : [];
    return {
      collectionId: col.id,
      destination,
      columnRoles: roles,
      statusMap:
        destination === 'posts'
          ? Object.fromEntries(statusValues.map((v) => [v, mapStatus(v)]))
          : {},
      clientAssignment: clientColumn
        ? { mode: 'column', column: clientColumn }
        : { mode: 'fixed', clienteNome: '' },
    };
  });
  return { collections };
}
