import { useCallback, useEffect, useRef, useState } from 'react';
import type { ContentFormat } from '@mesaas/platforms';
import { Check, ChevronDown, ExternalLink } from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { sanitizeUrl } from '@/router';
import type { Membro } from '@/store/team';
import type { LinhaColuna } from '@/store/linhaEditorial';
import type { SelectOption } from '@/store/posts';
import { TIPO_ORDER } from '../postLabels';
import { FormatoPill } from './FormatoPill';

// Cell editors of the linha editorial table. Every editable control carries `data-linha-nav`
// plus its row and column, which is what LinhaTable's Tab/Enter navigation walks. Values follow
// `post_property_values.value` shapes (the same conventions PropertyValue reads): select = option
// id, multiselect = option ids, person = `{ membro_id?, name }`, date = `YYYY-MM-DD`.

/** Debounce of text-like cells (spec §6.3 / plan Task 9). */
export const TEXT_DEBOUNCE_MS = 400;

export interface CellNav {
  row: number;
  col: string;
}

export const navProps = ({ row, col }: CellNav) => ({
  'data-linha-nav': '',
  'data-row': row,
  'data-col': col,
});

const optionsOf = (coluna: LinhaColuna): SelectOption[] =>
  Array.isArray(coluna.config?.options) ? coluna.config.options : [];

/** Sanitized absolute http(s) link, or null (bare words and relative paths get no link). */
function linkSeguro(raw: string): string | null {
  const v = raw.trim();
  if (!/^https?:\/\//i.test(v)) return null;
  const href = sanitizeUrl(v);
  return href && href !== '#' ? href : null;
}

/** `YYYY-MM-DD` to `dd/MM`, or '' for null. */
export function formatDia(iso: string | null): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}` : '';
}

/**
 * Local state for a debounced field. `change` updates the input at once and saves after
 * `delay`; `flush` saves now (blur, unmount). While a save is pending the unsaved-work registry
 * is held, so a silent update never drops a half-typed cell. A new `value` from the cache
 * replaces the local one only when nothing is pending.
 */
function useDebouncedField<T>(value: T, onSave: (v: T) => void, delay = TEXT_DEBOUNCE_MS) {
  const [local, setLocal] = useState(value);
  const [dirty, setDirty] = useState(false);
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  useUnsavedWork(dirty);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    setDirty(false);
    if (p) saveRef.current(p.v);
  }, []);

  const change = (v: T) => {
    setLocal(v);
    pending.current = { v };
    setDirty(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, delay);
  };

  useEffect(() => {
    if (!pending.current) setLocal(value);
  }, [value]);

  useEffect(() => flush, [flush]);

  return { local, change, flush };
}

interface TextCellProps {
  value: string;
  label: string;
  nav: CellNav;
  onSave: (v: string) => void;
  multiline?: boolean;
  type?: 'text' | 'url' | 'number';
  placeholder?: string;
}

/** Título, Direção, text/url/number columns. Enter is handled by the table (move down). */
export function TextCell({
  value,
  label,
  nav,
  onSave,
  multiline,
  type = 'text',
  placeholder,
}: TextCellProps) {
  const { local, change, flush } = useDebouncedField(value, (v) => {
    if (v !== value) onSave(v);
  });
  if (multiline) {
    return (
      <textarea
        className="linha-input linha-input--multi"
        aria-label={label}
        value={local}
        rows={1}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
        {...navProps(nav)}
      />
    );
  }
  const safeHref = type === 'url' ? linkSeguro(local) : null;
  return (
    <span className="linha-input-wrap">
      <input
        className="linha-input"
        aria-label={label}
        type={type === 'number' ? 'text' : type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        value={local}
        placeholder={placeholder}
        onChange={(e) => change(e.target.value)}
        onBlur={flush}
        {...navProps(nav)}
      />
      {safeHref && (
        <a
          className="linha-input-link"
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Abrir ${label}`}
          tabIndex={-1}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}
    </span>
  );
}

interface DateCellProps {
  value: string | null;
  label: string;
  nav: CellNav;
  onSave: (v: string | null) => void;
}

/** A full date with a plausible year: typing a year passes through 0002, 0020, 0202... */
const DATA_PLAUSIVEL = /^(19|20|21)\d{2}-\d{2}-\d{2}$/;

/**
 * Native date input. Any day is allowed, including outside the linha's month (a post planned
 * for the start of the next month stays in this plan). Typing a year fires `change` with
 * intermediate values (0002, 0020...), so the save is debounced and only a full date with a
 * plausible year (or an empty field) is written; anything else reverts on blur.
 */
export function DateCell({ value, label, nav, onSave }: DateCellProps) {
  const valido = (v: string) => v === '' || DATA_PLAUSIVEL.test(v);
  const { local, change, flush } = useDebouncedField(value ?? '', (v) => {
    if (valido(v) && v !== (value ?? '')) onSave(v || null);
  });
  return (
    <input
      className="linha-input linha-input--date"
      type="date"
      aria-label={label}
      value={local}
      onChange={(e) => change(e.target.value)}
      onBlur={() => {
        const invalido = !valido(local);
        flush();
        if (invalido) {
          change(value ?? '');
          flush();
        }
      }}
      {...navProps(nav)}
    />
  );
}

/** Formato: a menu of the four formats. */
export function FormatoCell({
  value,
  nav,
  onSave,
}: {
  value: ContentFormat;
  nav: CellNav;
  onSave: (v: ContentFormat) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="linha-cell-btn" aria-label="Formato" {...navProps(nav)}>
          <FormatoPill tipo={value} />
          <ChevronDown className="linha-cell-btn__chev h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {TIPO_ORDER.map((tipo) => (
          <DropdownMenuItem key={tipo} onSelect={() => tipo !== value && onSave(tipo)}>
            <FormatoPill tipo={tipo} />
            {tipo === value && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OptionChip({ opt }: { opt: SelectOption }) {
  return (
    <span
      className="linha-chip"
      style={{ background: `${opt.color}22`, color: opt.color, borderColor: `${opt.color}55` }}
    >
      {opt.label}
    </span>
  );
}

interface ValorProps {
  coluna: LinhaColuna;
  value: unknown;
  membros: Membro[];
}

/** Read-only display of an extra column's value (converted rows). */
export function ValorDisplay({ coluna, value }: ValorProps) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return <span className="linha-vazio">-</span>;
  }
  switch (coluna.tipo) {
    case 'select': {
      const opt = optionsOf(coluna).find((o) => o.id === value);
      return opt ? <OptionChip opt={opt} /> : <span className="linha-vazio">-</span>;
    }
    case 'multiselect': {
      const ids = Array.isArray(value) ? value : [];
      const opts = optionsOf(coluna).filter((o) => ids.includes(o.id));
      return (
        <span className="linha-chips">
          {opts.map((o) => (
            <OptionChip key={o.id} opt={o} />
          ))}
        </span>
      );
    }
    case 'checkbox':
      return <span>{value === true ? 'Sim' : 'Não'}</span>;
    case 'date':
      return <span>{formatDia(String(value))}</span>;
    case 'person':
      return <span>{(value as { name?: string }).name ?? ''}</span>;
    case 'url': {
      const href = linkSeguro(String(value));
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="linha-link">
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      ) : (
        <span>{String(value)}</span>
      );
    }
    default:
      return <span className="linha-text">{String(value)}</span>;
  }
}

/** Editor of an extra column's value. `onSave(null)` clears it. */
export function ValorCell({
  coluna,
  value,
  membros,
  nav,
  onSave,
}: ValorProps & { nav: CellNav; onSave: (v: unknown) => void }) {
  const label = coluna.nome;
  switch (coluna.tipo) {
    case 'text':
    case 'url':
      return (
        <TextCell
          value={typeof value === 'string' ? value : ''}
          label={label}
          nav={nav}
          type={coluna.tipo}
          onSave={(v) => onSave(v.trim() === '' ? null : v)}
        />
      );
    case 'number':
      return (
        <TextCell
          value={typeof value === 'number' ? String(value) : ''}
          label={label}
          nav={nav}
          type="number"
          onSave={(v) => {
            const n = Number(v.replace(',', '.'));
            if (v.trim() === '') onSave(null);
            else if (Number.isFinite(n)) onSave(n);
          }}
        />
      );
    case 'date':
      return (
        <DateCell
          value={typeof value === 'string' ? value : null}
          label={label}
          nav={nav}
          onSave={onSave}
        />
      );
    case 'checkbox':
      return (
        <input
          type="checkbox"
          className="linha-check"
          aria-label={label}
          checked={value === true}
          onChange={(e) => onSave(e.target.checked ? true : null)}
          {...navProps(nav)}
        />
      );
    case 'person': {
      const v = (value ?? {}) as { membro_id?: number; name?: string };
      return (
        <select
          className="linha-input linha-input--select"
          aria-label={label}
          value={v.membro_id ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value);
            const membro = membros.find((mb) => mb.id === id);
            onSave(e.target.value && membro ? { membro_id: id, name: membro.nome } : null);
          }}
          {...navProps(nav)}
        >
          <option value="">{v.membro_id == null && v.name ? v.name : 'Ninguém'}</option>
          {membros.map((mb) => (
            <option key={mb.id} value={mb.id}>
              {mb.nome}
            </option>
          ))}
        </select>
      );
    }
    case 'select':
    case 'multiselect': {
      const opts = optionsOf(coluna);
      const multi = coluna.tipo === 'multiselect';
      const ids: string[] = multi
        ? Array.isArray(value)
          ? (value as string[])
          : []
        : typeof value === 'string'
          ? [value]
          : [];
      const selecionadas = opts.filter((o) => ids.includes(o.id));
      return (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="linha-cell-btn" aria-label={label} {...navProps(nav)}>
              {selecionadas.length ? (
                <span className="linha-chips">
                  {selecionadas.map((o) => (
                    <OptionChip key={o.id} opt={o} />
                  ))}
                </span>
              ) : (
                <span className="linha-vazio">-</span>
              )}
              <ChevronDown className="linha-cell-btn__chev h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {opts.length === 0 && (
              <DropdownMenuItem disabled>Sem opções. Crie em Colunas.</DropdownMenuItem>
            )}
            {multi
              ? opts.map((o) => (
                  <DropdownMenuCheckboxItem
                    key={o.id}
                    checked={ids.includes(o.id)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(on) => {
                      const next = on ? [...ids, o.id] : ids.filter((id) => id !== o.id);
                      onSave(next.length ? next : null);
                    }}
                  >
                    <OptionChip opt={o} />
                  </DropdownMenuCheckboxItem>
                ))
              : opts.map((o) => (
                  <DropdownMenuItem key={o.id} onSelect={() => o.id !== value && onSave(o.id)}>
                    {o.label}
                    {o.id === value && <Check className="ml-auto h-4 w-4" aria-hidden="true" />}
                  </DropdownMenuItem>
                ))}
            {!multi && ids.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onSave(null)}>Limpar</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    default:
      return <ValorDisplay coluna={coluna} value={value} membros={membros} />;
  }
}
