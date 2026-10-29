import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getGoogleAuthUrl,
  GoogleServiceError,
  linkGbpLocations,
  listGbpLocationOptions,
  type GbpConnectionSummary,
  type GbpLocationOptionView,
} from '../../services/google';

export interface GbpUnitsDialogProps {
  clienteId: number;
  clienteNome: string;
  connections: GbpConnectionSummary[];
  initialConnectionId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function errorCode(err: unknown): GoogleServiceError['code'] {
  return err instanceof GoogleServiceError ? err.code : 'unknown';
}

function isLinkedElsewhere(option: GbpLocationOptionView, clienteId: number): boolean {
  return option.linkedClientId != null && option.linkedClientId !== clienteId;
}

// Linked to this client, but through another Google connection: only that connection's picker
// manages it, so here it shows checked and locked, outside the save set (the server ignores it).
function isLinkedViaOtherAccount(
  option: GbpLocationOptionView,
  clienteId: number,
  connectionId: string | null,
): boolean {
  return (
    option.linkedClientId === clienteId &&
    option.linkedConnectionId != null &&
    option.linkedConnectionId !== connectionId
  );
}

// A unit linked to this client stays toggleable even when Google now reports it unverified,
// so the user can uncheck it to unlink; unverified units not linked to this client cannot be added.
function isSelectable(
  option: GbpLocationOptionView,
  clienteId: number,
  connectionId: string | null,
): boolean {
  if (isLinkedElsewhere(option, clienteId)) return false;
  if (isLinkedViaOtherAccount(option, clienteId, connectionId)) return false;
  return option.eligible || option.linkedClientId === clienteId;
}

// Unit picker for Google Meu Negócio. The server re-lists from Google on save and rejects
// names it did not return, so the checked names are the only thing sent.
export function GbpUnitsDialog({
  clienteId,
  clienteNome,
  connections,
  initialConnectionId,
  open,
  onOpenChange,
}: GbpUnitsDialogProps) {
  const { t } = useTranslation('clients');
  const queryClient = useQueryClient();

  const [connectionId, setConnectionId] = useState<string | null>(
    initialConnectionId ?? connections[0]?.id ?? null,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [baseline, setBaseline] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<GoogleServiceError['code'] | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  // Re-aim at the requested connection each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setConnectionId(initialConnectionId ?? connections[0]?.id ?? null);
    setActionError(null);
    // The dialog component stays mounted while closed, so discarded edits would otherwise
    // reappear: go back to the loaded baseline. (A refetch that returns different units
    // re-seeds both sets in the effect below.)
    setSelected(baseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open / requested connection
  }, [open, initialConnectionId]);

  const connection = connections.find((c) => c.id === connectionId) ?? null;

  const {
    data: page,
    isLoading,
    isFetching,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ['gbpLocationOptions', clienteId, connectionId],
    queryFn: () => listGbpLocationOptions(clienteId, connectionId as string),
    enabled: open && !!connectionId,
    // Each call walks every GBP account on the Google side (rate-limited): never reuse, never retry.
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const options = page?.options;

  // This client's linked units on this connection start checked; that set is also the
  // "unchanged" baseline. A linked unit Google now reports as unverified stays in it so a save
  // never unlinks it silently; the backend accepts names already linked to this client. Units
  // linked through another connection stay out of both sets (shown checked and locked).
  useEffect(() => {
    if (!options) return;
    const initial = new Set(
      options
        .filter(
          (o) =>
            o.linkedClientId === clienteId && !isLinkedViaOtherAccount(o, clienteId, connectionId),
        )
        .map((o) => o.locationName),
    );
    setSelected(initial);
    setBaseline(initial);
  }, [options, clienteId, connectionId]);

  const dirty = useMemo(() => {
    if (selected.size !== baseline.size) return true;
    for (const name of selected) if (!baseline.has(name)) return true;
    return false;
  }, [selected, baseline]);

  const save = useMutation({
    mutationFn: () => linkGbpLocations(clienteId, connectionId as string, [...selected]),
    onSuccess: (linked) => {
      toast.success(
        linked > 0 ? t('gmn.dialog.saved', { count: linked }) : t('gmn.dialog.savedNone'),
      );
      queryClient.invalidateQueries({ queryKey: ['googleSummary', clienteId] });
      onOpenChange(false);
    },
    onError: (err) => {
      const code = errorCode(err);
      setActionError(code);
      if (code === 'location_unavailable') void refetch();
    },
  });

  async function handleReconnect() {
    setRedirecting(true);
    try {
      window.location.href = await getGoogleAuthUrl(clienteId, 'gbp');
    } catch {
      setRedirecting(false);
      setActionError('unknown');
    }
  }

  function toggle(name: string, checked: boolean) {
    setActionError(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(name);
      else next.delete(name);
      return next;
    });
  }

  const shownError = actionError ?? (loadError ? errorCode(loadError) : null);
  const list = options ?? [];
  const nothingToSave = selected.size === 0 && baseline.size === 0;

  const submitLabel = save.isPending
    ? t('gmn.dialog.saving')
    : selected.size === 0 && baseline.size > 0
      ? t('gmn.dialog.submitNone')
      : t('gmn.dialog.submit', { count: selected.size });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ maxWidth: 640 }}
        confirmClose={dirty}
        onConfirmClose={() => onOpenChange(false)}
      >
        <DialogHeader>
          <DialogTitle>{t('gmn.dialog.title', { cliente: clienteNome })}</DialogTitle>
          <DialogDescription>
            {options
              ? t('gmn.dialog.intro', { count: list.length, email: connection?.email ?? '' })
              : '\u00A0'}
          </DialogDescription>
        </DialogHeader>

        {connections.length > 1 && (
          <div className="space-y-1">
            <Label htmlFor="gbp-connection">{t('gmn.dialog.account')}</Label>
            <Select
              value={connectionId ?? undefined}
              onValueChange={(v) => {
                setConnectionId(v);
                setActionError(null);
              }}
            >
              <SelectTrigger id="gbp-connection">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connections.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {shownError === 'reconnect' ? (
          <div
            role="alert"
            className="badge-warning"
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              alignItems: 'flex-start',
              padding: '14px 16px',
              borderRadius: 12,
              background: 'var(--badge-bg)',
              border: '1px solid var(--badge-border)',
              color: 'var(--badge-fg)',
            }}
          >
            <AlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: '1 1 200px', fontSize: '0.875rem', lineHeight: 1.5 }}>
              {t('gmn.dialog.errors.reconnect')}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleReconnect}
              disabled={redirecting}
            >
              {t('gmn.reconnect')}
            </Button>
          </div>
        ) : (
          shownError && (
            <div
              role="alert"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 8,
                alignItems: 'center',
                fontSize: '0.875rem',
                color: 'var(--danger-text)',
              }}
            >
              <span>{t(`gmn.dialog.errors.${shownError}`)}</span>
              {loadError &&
                !actionError &&
                shownError !== 'gmn_not_approved' &&
                shownError !== 'feature_disabled' && (
                  <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>
                    {t('gmn.dialog.retry')}
                  </Button>
                )}
            </div>
          )
        )}

        <div className="flex max-h-[45vh] flex-col gap-2.5 overflow-y-auto">
          {(isLoading || (isFetching && !options)) && (
            <p
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                margin: 0,
                fontSize: '0.875rem',
                color: 'var(--text-light)',
              }}
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t('gmn.dialog.loading')}
            </p>
          )}
          {page?.truncated && (
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--text-light)' }}>
              {t('gmn.dialog.truncatedNote')}
            </p>
          )}
          {options && list.length === 0 && (
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-light)' }}>
              {t('gmn.dialog.empty')}
            </p>
          )}
          {list.map((option) => {
            const elsewhere = isLinkedElsewhere(option, clienteId);
            const otherAccount = isLinkedViaOtherAccount(option, clienteId, connectionId);
            const selectable = isSelectable(option, clienteId, connectionId);
            const id = `gbp-unit-${option.locationName}`;
            return (
              <div
                key={option.locationName}
                data-testid="gbp-unit-row"
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-start',
                  padding: '14px 16px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 10,
                  background: 'var(--card-bg)',
                  opacity: selectable ? 1 : 0.7,
                }}
              >
                <Checkbox
                  id={id}
                  className="mt-0.5"
                  disabled={!selectable || save.isPending}
                  checked={otherAccount || selected.has(option.locationName)}
                  onCheckedChange={(v) => toggle(option.locationName, v === true)}
                />
                <Label htmlFor={id} className="block min-w-0 flex-1 cursor-pointer font-normal">
                  <span style={{ display: 'block', fontWeight: 600, fontSize: '0.9375rem' }}>
                    {option.title}
                  </span>
                  {selectable && option.eligible && option.addressLine && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: '0.8125rem',
                        color: 'var(--text-light)',
                      }}
                    >
                      {option.addressLine}
                    </span>
                  )}
                  {(!selectable || !option.eligible) && (
                    <span
                      style={{
                        display: 'block',
                        marginTop: 2,
                        fontSize: '0.8125rem',
                        color: 'var(--text-light)',
                      }}
                    >
                      {otherAccount
                        ? t('gmn.dialog.otherAccountHint')
                        : elsewhere
                          ? t('gmn.dialog.inUseHint', { nome: option.linkedClientName ?? '' })
                          : t('gmn.dialog.unverifiedHint')}
                    </span>
                  )}
                </Label>
                {!otherAccount && (!selectable || !option.eligible) && (
                  <Badge variant={elsewhere ? 'neutral' : 'warning'}>
                    {elsewhere ? t('gmn.dialog.inUse') : t('gmn.dialog.unverified')}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            padding: '12px 14px',
            borderRadius: 10,
            background: 'var(--surface-1)',
            fontSize: '0.8125rem',
            lineHeight: 1.5,
            color: 'var(--text-light)',
          }}
        >
          {t('gmn.dialog.note')}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('gmn.dialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={save.isPending || !options || nothingToSave || !connectionId}
            onClick={() => {
              setActionError(null);
              save.mutate();
            }}
          >
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
