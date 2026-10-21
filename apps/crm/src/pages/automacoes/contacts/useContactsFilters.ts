import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ContactFilters } from '@/store';

export type AutomacoesTab = 'automacoes' | 'contatos';

export interface ContactsUrlState extends ContactFilters {
  page: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function parseContactsParams(sp: URLSearchParams): ContactsUrlState {
  const cliente = parseInt(sp.get('cliente') ?? '', 10);
  const de = sp.get('de');
  const ate = sp.get('ate');
  return {
    clientId: isNaN(cliente) ? null : cliente,
    automationId: sp.get('automacao') || null,
    from: de && YMD.test(de) ? de : null,
    to: ate && YMD.test(ate) ? ate : null,
    reachedOnly: sp.get('todos') !== '1',
    search: sp.get('q') ?? '',
    page: Math.max(1, parseInt(sp.get('pagina') ?? '', 10) || 1),
  };
}

function setOrDelete(sp: URLSearchParams, key: string, value: string | null) {
  if (value === null || value === '') sp.delete(key);
  else sp.set(key, value);
}

/** Applies a patch; any filter change (anything but `page`) resets to page 1.
 * Clearing or changing the client drops the automation (it belongs to one). */
export function writeContactsParams(
  sp: URLSearchParams,
  patch: Partial<ContactsUrlState>,
): URLSearchParams {
  const next = new URLSearchParams(sp);
  if ('clientId' in patch) {
    setOrDelete(next, 'cliente', patch.clientId == null ? null : String(patch.clientId));
    if (!('automationId' in patch)) next.delete('automacao');
  }
  if ('automationId' in patch) setOrDelete(next, 'automacao', patch.automationId ?? null);
  if ('from' in patch) setOrDelete(next, 'de', patch.from ?? null);
  if ('to' in patch) setOrDelete(next, 'ate', patch.to ?? null);
  if ('reachedOnly' in patch) setOrDelete(next, 'todos', patch.reachedOnly === false ? '1' : null);
  if ('search' in patch) setOrDelete(next, 'q', patch.search ?? null);
  if ('page' in patch) {
    setOrDelete(next, 'pagina', patch.page && patch.page > 1 ? String(patch.page) : null);
  } else {
    next.delete('pagina');
  }
  return next;
}

export function contactsHref(
  opts: { clientId?: number | null; automationId?: string | null } = {},
): string {
  const sp = new URLSearchParams({ aba: 'contatos' });
  if (opts.clientId != null) sp.set('cliente', String(opts.clientId));
  if (opts.automationId) sp.set('automacao', opts.automationId);
  return `/automacoes?${sp.toString()}`;
}

/** Third value: whether `aba` is explicitly in the URL. The page forces the
 * Contatos tab in the contacts-only (downgraded, no automations) state ONLY
 * while the user hasn't picked a tab, so `setTab` always writes `aba`. */
export function useAutomacoesTab(): [AutomacoesTab, (tab: AutomacoesTab) => void, boolean] {
  const [sp, setSp] = useSearchParams();
  const explicit = sp.has('aba');
  const tab: AutomacoesTab = sp.get('aba') === 'contatos' ? 'contatos' : 'automacoes';
  const setTab = useCallback(
    (t: AutomacoesTab) =>
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('aba', t);
          return next;
        },
        { replace: true },
      ),
    [setSp],
  );
  return [tab, setTab, explicit];
}

export function useContactsFilters() {
  const [sp, setSp] = useSearchParams();
  const state = useMemo(() => parseContactsParams(sp), [sp]);
  const setFilters = useCallback(
    (patch: Partial<ContactFilters>) =>
      setSp((prev) => writeContactsParams(prev, patch), { replace: true }),
    [setSp],
  );
  const setPage = useCallback(
    (page: number) => setSp((prev) => writeContactsParams(prev, { page }), { replace: true }),
    [setSp],
  );
  return { state, setFilters, setPage };
}
