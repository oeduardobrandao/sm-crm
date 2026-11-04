import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { ClienteFoto } from '@/components/ClienteFoto';
import { useClienteAvatars } from '@/hooks/useClienteAvatars';
import {
  getClientes,
  setWorkspaceUserClientScope,
  type Cliente,
  type ClientScope,
} from '../../../store';

export interface ClientAccessMember {
  user_id: string;
  nome: string;
  client_scope: ClientScope;
}

export interface ClientAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: ClientAccessMember;
  /** The member's current assignments (read by the owner). */
  initialIds: number[];
  /**
   * `feature_acesso_por_cliente`. Off, a restricted member can only be released
   * ("Liberar todos os clientes"): the flag gates moving someone INTO
   * 'atribuidos', never back out.
   */
  canRestrict?: boolean;
}

/** Plain buttons, not the link Button: a stylesheet margin on it pushed the
 *  links below the "·" separator. Inline, so no rule can add it back. */
const LINK_STYLE = {
  margin: 0,
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  lineHeight: 1.2,
  color: 'var(--text-main)',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
  cursor: 'pointer',
} as const;

/** The plain link buttons have no native disabled look. */
const linkStyle = (disabled: boolean) =>
  disabled ? { ...LINK_STYLE, opacity: 0.5, cursor: 'default' } : LINK_STYLE;

const firstName = (nome: string) => nome.trim().split(/\s+/)[0] || nome;

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function sameIds(a: ReadonlySet<number>, b: ReadonlySet<number>) {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

/**
 * State and save for one member's client access, shared by the desktop dialog and
 * the phone sheet. Mounted per open (the callers key it on the member), so the
 * initial values come straight from the props.
 */
function useClientAccessForm({
  member,
  initialIds,
  canRestrict,
  enabled,
  onSaved,
}: {
  member: ClientAccessMember;
  initialIds: number[];
  canRestrict: boolean;
  enabled: boolean;
  onSaved: () => void;
}) {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  // Same key and function as ClientesPage: the cache is shared.
  const clientesQuery = useQuery({ queryKey: ['clientes'], queryFn: getClientes, enabled });
  const clientes = useMemo(
    () =>
      [...(clientesQuery.data ?? [])]
        .filter((c): c is Cliente & { id: number } => c.id != null)
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
    [clientesQuery.data],
  );

  const initialSet = useMemo(() => new Set(initialIds), [initialIds]);
  const [scope, setScope] = useState<ClientScope>(member.client_scope);
  const [selected, setSelected] = useState<Set<number>>(() => new Set(initialIds));
  const [search, setSearch] = useState('');

  const liberarOnly = !canRestrict;
  const dirty =
    !liberarOnly &&
    (scope !== member.client_scope || (scope === 'atribuidos' && !sameIds(selected, initialSet)));

  const visible = useMemo(() => {
    const q = normalize(search.trim());
    return q ? clientes.filter((c) => normalize(c.nome).includes(q)) : clientes;
  }, [clientes, search]);
  const selectedIds = clientes
    .filter((c) => selected.has(c.id))
    .map((c) => c.id)
    .sort((a, b) => a - b);

  const save = useMutation({
    mutationFn: (next: { scope: ClientScope; ids: number[] }) =>
      setWorkspaceUserClientScope(member.user_id, next.scope, next.ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspace-users'] });
      void queryClient.invalidateQueries({ queryKey: ['workspace-member-clientes'] });
      toast.success(t('membros.clientAccess.saved'));
      onSaved();
    },
    onError: () => {
      toast.error(t('membros.clientAccess.saveError'));
    },
  });

  return {
    scope,
    setScope,
    search,
    setSearch,
    clientes,
    visible,
    clientesLoading: clientesQuery.isLoading,
    clientesError: clientesQuery.isError,
    selected,
    selectedCount: selectedIds.length,
    toggle: (id: number) =>
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    selectAllVisible: () =>
      setSelected((prev) => {
        const next = new Set(prev);
        for (const c of visible) next.add(c.id);
        return next;
      }),
    clear: () => setSelected(new Set()),
    liberarOnly,
    dirty,
    saving: save.isPending,
    // The list must be loaded before a restricted save: the ids sent are the
    // selected ones that still exist.
    // Nothing changed = nothing to send: a clean save would still bump
    // client_scope_rev (purging the member's caches), and on a degraded roster
    // read (every row 'todos') it would really release a restricted member.
    canSave: dirty && !save.isPending && (scope === 'todos' || clientesQuery.isSuccess),
    submit: () =>
      save.mutate(scope === 'todos' ? { scope: 'todos', ids: [] } : { scope, ids: selectedIds }),
    liberar: () => save.mutate({ scope: 'todos', ids: [] }),
  };
}

type ClientAccessForm = ReturnType<typeof useClientAccessForm>;

/** Scope choice, search, counter, list, zero warning and note: the shared body. */
function ClientAccessFields({
  form,
  member,
  variant,
}: {
  form: ClientAccessForm;
  member: ClientAccessMember;
  variant: 'dialog' | 'sheet';
}) {
  const { t } = useTranslation('settings');
  const { fotosDe } = useClienteAvatars(form.clientes);
  const sheet = variant === 'sheet';
  const name = member.nome;
  const radioName = `client-scope-${member.user_id}`;
  // Dialog: a flex column where only the list may shrink (see ClientAccessDialog).
  // Sheet: plain flow, the sheet scrolls as a whole.
  const fixed = sheet ? undefined : 'shrink-0';

  const options: { value: ClientScope; label: string; hint: string }[] = [
    {
      value: 'todos',
      label: sheet ? t('membros.clientAccess.phone.segAll') : t('membros.clientAccess.scopeAll'),
      hint: t('membros.clientAccess.scopeAllHint'),
    },
    {
      value: 'atribuidos',
      label: sheet
        ? t('membros.clientAccess.phone.segSelected')
        : t('membros.clientAccess.scopeSelected'),
      hint: t('membros.clientAccess.scopeSelectedHint'),
    },
  ];

  return (
    <div className={sheet ? 'space-y-3' : 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto'}>
      <div
        role="radiogroup"
        aria-label={t('membros.clientAccess.column')}
        className={sheet ? 'grid grid-cols-2 gap-2' : 'shrink-0 space-y-2'}
      >
        {options.map((o) => {
          const checked = form.scope === o.value;
          return (
            <label
              key={o.value}
              className="flex cursor-pointer items-start gap-3"
              style={{
                border: `1px solid ${checked ? 'var(--text-main)' : 'var(--border-color)'}`,
                borderRadius: 10,
                padding: sheet ? '0 12px' : '10px 12px',
                minHeight: sheet ? 44 : undefined,
                alignItems: sheet ? 'center' : 'flex-start',
                justifyContent: sheet ? 'center' : undefined,
              }}
            >
              <input
                type="radio"
                name={radioName}
                value={o.value}
                checked={checked}
                onChange={() => form.setScope(o.value)}
                className={sheet ? 'sr-only' : 'mt-1'}
              />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>{o.label}</span>
                {!sheet && (
                  <span
                    style={{ display: 'block', fontSize: 13, color: 'var(--text-muted)' }}
                    aria-hidden="true"
                  >
                    {o.hint}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>

      {form.scope === 'atribuidos' && (
        <>
          <div className={cn('relative', fixed)}>
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            />
            <Input
              type="search"
              value={form.search}
              onChange={(e) => form.setSearch(e.target.value)}
              placeholder={t('membros.clientAccess.search')}
              aria-label={t('membros.clientAccess.search')}
              className="pl-8"
            />
          </div>

          <div
            className={cn('flex items-center justify-between gap-2', fixed)}
            style={{ fontSize: 13 }}
          >
            <span style={{ color: 'var(--text-muted)' }} aria-live="polite">
              {!form.clientesError &&
                t('membros.clientAccess.counter', {
                  n: form.selectedCount,
                  total: form.clientes.length,
                })}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                style={linkStyle(form.visible.length === 0)}
                onClick={form.selectAllVisible}
                disabled={form.visible.length === 0}
              >
                {t('membros.clientAccess.selectAll')}
              </button>
              <span aria-hidden="true" style={{ color: 'var(--text-muted)', lineHeight: 1 }}>
                ·
              </span>
              <button
                type="button"
                style={linkStyle(form.selected.size === 0)}
                onClick={form.clear}
                disabled={form.selected.size === 0}
              >
                {t('membros.clientAccess.clear')}
              </button>
            </span>
          </div>

          <ul
            aria-label={t('membros.clientAccess.listAria', { name })}
            // Dialog: up to 236px; gives way on a short viewport down to 96px, then the
            // dialog body scrolls.
            className={sheet ? undefined : 'min-h-0 flex-1 overflow-y-auto'}
            style={{
              maxHeight: sheet ? undefined : 236,
              minHeight: sheet ? undefined : 96,
              border: '1px solid var(--border-color)',
              borderRadius: 10,
            }}
          >
            {form.clientesLoading ? (
              <li className="flex justify-center p-4">
                <Spinner size="sm" />
              </li>
            ) : form.clientesError ? (
              <li className="p-3" style={{ fontSize: 13, color: 'var(--danger-text)' }}>
                {t('membros.clientAccess.loadError')}
              </li>
            ) : form.visible.length === 0 ? (
              <li className="p-3" style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {form.clientes.length === 0
                  ? t('membros.clientAccess.noClients')
                  : t('membros.clientAccess.noResults')}
              </li>
            ) : (
              form.visible.map((c) => {
                const id = `client-access-${member.user_id}-${c.id}`;
                return (
                  <li key={c.id}>
                    <label
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-3"
                      style={{
                        padding: '0 12px',
                        minHeight: sheet ? 48 : 40,
                        fontSize: sheet ? 15 : 14,
                      }}
                    >
                      <Checkbox
                        id={id}
                        aria-label={c.nome}
                        checked={form.selected.has(c.id)}
                        onCheckedChange={() => form.toggle(c.id)}
                        className={sheet ? 'h-[18px] w-[18px]' : undefined}
                      />
                      <ClienteFoto
                        srcs={fotosDe(c)}
                        className="avatar"
                        style={{ width: 28, height: 28, objectFit: 'cover', flexShrink: 0 }}
                        fallback={
                          <span
                            className="avatar"
                            aria-hidden="true"
                            style={{
                              width: 28,
                              height: 28,
                              fontSize: '0.7rem',
                              background: c.cor,
                              color: '#fff',
                              fontWeight: 700,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {c.sigla}
                          </span>
                        }
                      />
                      <span
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.nome}
                      </span>
                    </label>
                  </li>
                );
              })
            )}
          </ul>

          {form.selectedCount === 0 && !form.clientesLoading && !form.clientesError && (
            <div
              role="status"
              className={cn('badge badge-warning', fixed)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                alignSelf: 'flex-start',
              }}
            >
              <AlertTriangle size={14} aria-hidden="true" />
              {t('membros.clientAccess.zeroWarning', { name })}
            </div>
          )}

          <p
            className={fixed}
            style={{
              fontSize: 12,
              color: 'var(--text-muted)',
              background: 'var(--surface-1)',
              borderRadius: 8,
              padding: '8px 10px',
            }}
          >
            {sheet
              ? t('membros.clientAccess.noteShort', { name })
              : t('membros.clientAccess.note', { name })}
          </p>
        </>
      )}
    </div>
  );
}

/** Desktop: "Acesso a clientes · {nome}". Unsaved changes ask before closing. */
export function ClientAccessDialog({
  open,
  onOpenChange,
  member,
  initialIds,
  canRestrict = true,
}: ClientAccessDialogProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const form = useClientAccessForm({
    member,
    initialIds,
    canRestrict,
    enabled: open,
    onSaved: () => onOpenChange(false),
  });
  // DialogContent guards the X, Escape and outside clicks; the footer Cancelar
  // calls onOpenChange directly, so it asks through its own confirm.
  const [confirmCancel, setConfirmCancel] = useState(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          // Flex columns all the way down, inside the primitive's 85vh cap: the box
          // and its inner wrapper (data-dialog-scroll) stop scrolling, every
          // section is shrink-0 and the client list gives way first (to its min-height),
          // after which the fields area (not the header/footer) scrolls.
          className="flex flex-col [&>[data-dialog-scroll]]:flex [&>[data-dialog-scroll]]:min-h-0 [&>[data-dialog-scroll]]:flex-col [&>[data-dialog-scroll]]:overflow-hidden"
          style={{ maxWidth: 512 }}
          confirmClose={form.dirty}
          onConfirmClose={() => onOpenChange(false)}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>{t('membros.clientAccess.title', { name: member.nome })}</DialogTitle>
            <DialogDescription>
              {form.liberarOnly
                ? t('membros.clientAccess.liberarHint', { name: member.nome })
                : t('membros.clientAccess.description', { firstName: firstName(member.nome) })}
            </DialogDescription>
          </DialogHeader>

          {!form.liberarOnly && <ClientAccessFields form={form} member={member} variant="dialog" />}

          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => (form.dirty ? setConfirmCancel(true) : onOpenChange(false))}
            >
              {t('actions.cancel')}
            </Button>
            {form.liberarOnly ? (
              <Button type="button" onClick={form.liberar} disabled={form.saving}>
                {form.saving && <Spinner size="sm" />} {t('membros.clientAccess.liberar')}
              </Button>
            ) : (
              <Button type="button" onClick={form.submit} disabled={!form.canSave}>
                {form.saving && <Spinner size="sm" />} {t('actions.save')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tc('ui.confirmClose.title')}</AlertDialogTitle>
            <AlertDialogDescription>{tc('ui.confirmClose.message')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc('ui.confirmClose.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmCancel(false);
                onOpenChange(false);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tc('ui.confirmClose.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** Phone: the same body in a bottom sheet, "Clientes de {primeiro nome}". */
export function ClientAccessSheet({
  open,
  onOpenChange,
  member,
  initialIds,
  canRestrict = true,
}: ClientAccessDialogProps) {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation();
  const form = useClientAccessForm({
    member,
    initialIds,
    canRestrict,
    enabled: open,
    onSaved: () => onOpenChange(false),
  });
  // Holds a silent deploy swap while there are unsaved choices on screen.
  useUnsavedWork(open && form.dirty);
  // Back, swipe-down, the X and a tap outside all arrive here: with unsaved
  // choices the close is refused (repushIfStillOpen restores the history
  // entry) and the confirm asks first.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestOpenChange = (next: boolean) => {
    if (!next && form.dirty && !form.saving) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(next);
  };

  // A failed client list has no meaningful total: no count (as the desktop counter).
  const subtitle =
    form.scope === 'todos'
      ? t('membros.clientAccess.allClients')
      : form.clientesError
        ? undefined
        : t('membros.clientAccess.phone.countSelected', {
            n: form.selectedCount,
            total: form.clientes.length,
          });

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={requestOpenChange}
        repushIfStillOpen
        popOnUnmount
        title={t('membros.clientAccess.phone.title', { firstName: firstName(member.nome) })}
        description={
          form.liberarOnly ? t('membros.clientAccess.liberarHint', { name: member.nome }) : subtitle
        }
        detents={['large']}
      >
        <div style={{ padding: '0 16px' }}>
          {!form.liberarOnly && <ClientAccessFields form={form} member={member} variant="sheet" />}
        </div>
        <div className="phone-membros-sheet-actions">
          {form.liberarOnly ? (
            <button
              type="button"
              className="phone-config-primary phone-config-primary--block"
              disabled={form.saving}
              aria-busy={form.saving || undefined}
              onClick={form.liberar}
            >
              {t('membros.clientAccess.liberar')}
            </button>
          ) : (
            <button
              type="button"
              className="phone-config-primary phone-config-primary--block"
              disabled={!form.canSave}
              aria-busy={form.saving || undefined}
              onClick={form.submit}
            >
              {t('actions.save')}
            </button>
          )}
        </div>
      </BottomSheet>
      <PhoneConfirmSheet
        open={confirmDiscard}
        title={tc('ui.confirmClose.title')}
        message={tc('ui.confirmClose.message')}
        actions={[
          {
            label: tc('ui.confirmClose.discard'),
            destructive: true,
            onSelect: () => {
              setConfirmDiscard(false);
              onOpenChange(false);
            },
          },
        ]}
        cancelLabel={tc('ui.confirmClose.keepEditing')}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
  );
}
