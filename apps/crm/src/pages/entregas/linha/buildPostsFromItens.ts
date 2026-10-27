import type { JSONContent } from '@tiptap/core';
import type { TemplatePropertyDefinition } from '@/store/posts';
import type { ConverterPostPayload, LinhaColuna, LinhaItem } from '@/store/linhaEditorial';
import { normalizeNome } from './linhaLogic';

// Builds the `p_posts` payload of `linha_editorial_converter` (spec section 7). Pure: the RPC
// takes titulo, tipo and scheduled_at from the locked item, so none of them travels here.

type Option = { id: string; label: string };

const optionsOf = (config: unknown): Option[] => {
  const opts = (config as { options?: Option[] } | null | undefined)?.options;
  return Array.isArray(opts) ? opts : [];
};

const bold = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text, marks: [{ type: 'bold' }] }],
});

const paragraph = (text: string): JSONContent => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

function isEmpty(tipo: LinhaColuna['tipo'], v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  if (tipo === 'checkbox') return v !== true;
  return false;
}

function formatDate(v: unknown): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
}

/** Display text of a value for the "Nome: valor" bullet; null when nothing readable remains. */
function displayValue(col: LinhaColuna, v: unknown): string | null {
  switch (col.tipo) {
    case 'select': {
      const label = optionsOf(col.config).find((o) => o.id === v)?.label;
      return label ?? null;
    }
    case 'multiselect': {
      const opts = optionsOf(col.config);
      const labels = (Array.isArray(v) ? v : [])
        .map((id) => opts.find((o) => o.id === id)?.label)
        .filter((l): l is string => !!l);
      return labels.length ? labels.join(', ') : null;
    }
    case 'date':
      return formatDate(v);
    case 'person':
      return (v as { name?: string })?.name?.trim() || null;
    case 'checkbox':
      return 'Sim';
    default:
      return String(v).trim();
  }
}

/**
 * Value for the matching template property, or `undefined` when the value has no home there
 * (a select label missing from the definition's options), which sends it to the bullets.
 */
function propertyValue(col: LinhaColuna, def: TemplatePropertyDefinition, v: unknown): unknown {
  if (col.tipo === 'select' || col.tipo === 'multiselect') {
    const colOpts = optionsOf(col.config);
    const defOpts = optionsOf(def.config);
    const ids = col.tipo === 'select' ? [v] : Array.isArray(v) ? v : [];
    const mapped: string[] = [];
    for (const id of ids) {
      const label = colOpts.find((o) => o.id === id)?.label;
      const hit = label
        ? defOpts.find((o) => normalizeNome(o.label) === normalizeNome(label))
        : undefined;
      if (!hit) return undefined;
      mapped.push(hit.id);
    }
    return col.tipo === 'select' ? mapped[0] : mapped;
  }
  return v;
}

function bulletParagraph(col: LinhaColuna, text: string): JSONContent {
  if (col.tipo === 'url') {
    return {
      type: 'paragraph',
      content: [
        { type: 'text', text: `${col.nome}: ` },
        { type: 'text', text, marks: [{ type: 'link', attrs: { href: text } }] },
      ],
    };
  }
  return paragraph(`${col.nome}: ${text}`);
}

/** Text of the top-level blocks, one line per paragraph / bullet, joined by a newline. */
function plainOf(doc: JSONContent): string {
  const text = (n: JSONContent): string => n.text ?? (n.content ?? []).map(text).join('');
  const lines: string[] = [];
  for (const block of doc.content ?? []) {
    if (block.type === 'bulletList') for (const li of block.content ?? []) lines.push(text(li));
    else lines.push(text(block));
  }
  return lines.join('\n');
}

export function buildPostsFromItens(
  itens: LinhaItem[],
  colunas: LinhaColuna[],
  defs: TemplatePropertyDefinition[] | null,
): ConverterPostPayload[] {
  const ordered = [...colunas].sort((a, b) => a.ordem - b.ordem);
  const defByName = new Map<string, TemplatePropertyDefinition>();
  for (const d of defs ?? []) {
    const key = normalizeNome(d.name);
    if (d.id !== undefined && !defByName.has(key)) defByName.set(key, d);
  }

  return itens.map((item) => {
    const content: JSONContent[] = [];
    const lines = item.direcao
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length) content.push(bold('Direção do conteúdo'), ...lines.map(paragraph));

    const property_values: ConverterPostPayload['property_values'] = [];
    const bullets: JSONContent[] = [];
    for (const col of ordered) {
      const raw = item.valores[col.id];
      if (isEmpty(col.tipo, raw)) continue;

      const def = defByName.get(normalizeNome(col.nome));
      if (def && def.type === col.tipo) {
        const value = propertyValue(col, def, raw);
        if (value !== undefined) {
          property_values.push({ property_definition_id: def.id as number, value });
          continue;
        }
      }
      const text = displayValue(col, raw);
      if (text) bullets.push({ type: 'listItem', content: [bulletParagraph(col, text)] });
    }
    if (bullets.length) {
      content.push(bold('Da linha editorial'), { type: 'bulletList', content: bullets });
    }

    const conteudo: JSONContent = {
      type: 'doc',
      content: content.length ? content : [{ type: 'paragraph' }],
    };
    return { item_id: item.id, conteudo, conteudo_plain: plainOf(conteudo), property_values };
  });
}
