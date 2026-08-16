import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Info,
  Instagram,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { useAuth } from '../../context/AuthContext';
import { avatarColorClass } from '@/lib/avatarColor';
import { handleEntitlementMutationError } from '../../lib/entitlement-toast';
import { sanitizeUrl } from '@/utils/security';
import {
  getInstagramAutomations,
  updateInstagramAutomation,
  deleteInstagramAutomation,
  getInstagramAutomationSends,
  getClientes,
  getInitials,
  type InstagramCommentAutomation,
  type InstagramAutomationSend,
  type Cliente,
} from '../../store';
import AutomationFormDialog from './AutomationFormDialog';

/** Module-level so other surfaces (e.g. useEffectiveNavFeatures' sibling
 * count query) can invalidate the same cache entry after a write. */
export const AUTOMATIONS_KEY = ['instagram-automations'];

const SEND_STATUS_VARIANT: Record<
  InstagramAutomationSend['status'],
  NonNullable<BadgeProps['variant']>
> = {
  sent: 'success',
  sent_partial: 'warning',
  failed: 'danger',
  skipped: 'neutral',
  retry: 'info',
  processing: 'info',
};

function formatDate(iso: string, lang: string): string {
  return format(new Date(iso), "dd MMM yyyy '·' HH:mm", {
    locale: lang.startsWith('en') ? enUS : ptBR,
  });
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function AutomacoesPage() {
  const { t, i18n } = useTranslation('automations');
  const { role, profile } = useAuth();
  const isAgent = role === 'agent';
  const qc = useQueryClient();

  const [clientFilter, setClientFilter] = useState<number | 'todos'>('todos');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<InstagramCommentAutomation | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InstagramCommentAutomation | null>(null);

  const { data: automations = [], isLoading } = useQuery({
    queryKey: AUTOMATIONS_KEY,
    queryFn: getInstagramAutomations,
  });
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  const clientesById = useMemo(() => {
    const map = new Map<number, Cliente>();
    for (const c of clientes) if (c.id != null) map.set(c.id, c);
    return map;
  }, [clientes]);

  const sendsQuery = useQuery({
    queryKey: ['instagram-automation-sends', expandedId],
    queryFn: () => getInstagramAutomationSends(expandedId as string),
    enabled: expandedId != null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: AUTOMATIONS_KEY });
    // Sidebar/MobileNav's automations-count query (useEffectiveNavFeatures)
    // has its own 5min staleTime -- without this, deleting the last
    // automation leaves the nav item visible for up to 5 minutes.
    qc.invalidateQueries({ queryKey: ['instagram-automations-count'] });
  };
  const onMutationError = (err: unknown, fallback: string) => {
    if (!handleEntitlementMutationError(err, profile?.conta_id ?? null)) toast.error(fallback);
  };

  // Toggle and delete route through the same onMutationError as the
  // create/edit dialog (handleEntitlementMutationError first, plain fallback
  // toast otherwise) for consistency -- in practice the entitlement branch is
  // a no-op here, since toggle/delete are never gated by the automation
  // feature flag (a downgrade only blocks CREATING new automations, per the
  // post-downgrade policy).
  const toggleMutation = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) =>
      updateInstagramAutomation(id, { ativo }),
    onSuccess: invalidate,
    onError: (err) => onMutationError(err, t('toastUpdateError')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteInstagramAutomation(id),
    onSuccess: () => {
      toast.success(t('toastDeleted'));
      invalidate();
    },
    onError: (err) => onMutationError(err, t('toastDeleteError')),
  });

  const clientesComAutomacao = useMemo(() => {
    const ids = new Set(automations.map((a) => a.client_id));
    return clientes.filter((c) => c.id != null && ids.has(c.id));
  }, [automations, clientes]);

  const filtered = useMemo(
    () =>
      clientFilter === 'todos'
        ? automations
        : automations.filter((a) => a.client_id === clientFilter),
    [automations, clientFilter],
  );

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (a: InstagramCommentAutomation) => {
    setEditing(a);
    setFormOpen(true);
  };

  const columnCount = isAgent ? 8 : 9;

  return (
    <div style={{ padding: '1.5rem' }}>
      <div className="header">
        <div
          className="header-title"
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <h1>{t('title')}</h1>
        </div>
        {!isAgent && (
          <div className="header-actions">
            <FeatureGate flag="feature_instagram_automation" label={t('featureLabel')}>
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" style={{ marginRight: '0.5rem' }} /> {t('newAutomation')}
              </Button>
            </FeatureGate>
          </div>
        )}
      </div>

      <p
        className="flex items-center gap-1.5"
        style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 1rem' }}
      >
        <Info className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />
        {t('tiebreakHint')}
      </p>

      {clientesComAutomacao.length > 0 && (
        <div style={{ marginBottom: '1rem', maxWidth: 260 }}>
          <Select
            value={String(clientFilter)}
            onValueChange={(v) => setClientFilter(v === 'todos' ? 'todos' : Number(v))}
          >
            <SelectTrigger aria-label={t('filterByClient')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t('allClients')}</SelectItem>
              {clientesComAutomacao.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.nome}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : (
        <div className="card animate-up" style={{ padding: '0.25rem 0', overflowX: 'auto' }}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead style={{ width: 32 }} />
                <TableHead style={{ paddingLeft: '0.5rem' }}>{t('table.automation')}</TableHead>
                <TableHead>{t('table.client')}</TableHead>
                <TableHead>{t('table.target')}</TableHead>
                <TableHead>{t('table.keywords')}</TableHead>
                <TableHead>{t('table.dmsSent')}</TableHead>
                <TableHead>{t('table.lastTriggered')}</TableHead>
                <TableHead>{t('table.active')}</TableHead>
                {!isAgent && <TableHead style={{ width: 60 }} />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={columnCount}
                    style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}
                  >
                    {automations.length === 0 ? t('emptyNone') : t('emptyForClient')}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((a) => {
                const cliente = clientesById.get(a.client_id);
                const expanded = expandedId === a.id;
                return (
                  <Fragment key={a.id}>
                    <TableRow
                      style={{ cursor: 'pointer' }}
                      onClick={() => setExpandedId(expanded ? null : a.id)}
                      aria-expanded={expanded}
                    >
                      <TableCell>
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell style={{ fontWeight: 600, paddingLeft: '0.5rem' }}>
                        {a.name}
                      </TableCell>
                      <TableCell>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div
                            className={`avatar ${avatarColorClass(cliente?.id ?? cliente?.nome)}`}
                            style={{ width: 24, height: 24, fontSize: '0.65rem', flexShrink: 0 }}
                          >
                            {cliente ? getInitials(cliente.nome) : '?'}
                          </div>
                          <span>{cliente?.nome ?? t('clientRemoved')}</span>
                        </div>
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {a.media_permalink ? (
                          <a
                            href={sanitizeUrl(a.media_permalink)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1"
                            style={{ color: 'var(--primary-color)' }}
                          >
                            <Instagram className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />
                            {a.media_caption ? truncate(a.media_caption, 40) : t('viewPost')}
                            <ExternalLink className="h-3 w-3" style={{ flexShrink: 0 }} />
                          </a>
                        ) : (
                          <Badge variant="neutral" size="sm">
                            {t('allPosts')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {a.keywords.map((k) => (
                            <Badge key={k} variant="outline" size="sm">
                              {k}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>{a.dms_sent_count}</TableCell>
                      <TableCell style={{ whiteSpace: 'nowrap' }}>
                        {a.last_triggered_at
                          ? formatDate(a.last_triggered_at, i18n.language)
                          : t('neverTriggered')}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {isAgent ? (
                          <Badge variant={a.ativo ? 'success' : 'neutral'} size="sm">
                            {a.ativo ? t('status.active') : t('status.inactive')}
                          </Badge>
                        ) : (
                          <Switch
                            checked={a.ativo}
                            aria-label={a.ativo ? t('switchDeactivate') : t('switchActivate')}
                            onCheckedChange={(ativo) => toggleMutation.mutate({ id: a.id, ativo })}
                          />
                        )}
                      </TableCell>
                      {!isAgent && (
                        <TableCell
                          onClick={(e) => e.stopPropagation()}
                          style={{ textAlign: 'right' }}
                        >
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                aria-label={t('rowActions', { name: a.name })}
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEdit(a)}>
                                <Pencil className="h-3.5 w-3.5" style={{ marginRight: '0.5rem' }} />
                                {t('edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(a)}
                                className="text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" style={{ marginRight: '0.5rem' }} />
                                {t('delete')}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      )}
                    </TableRow>
                    {expanded && (
                      <TableRow>
                        <TableCell
                          colSpan={columnCount}
                          style={{ background: 'var(--surface-hover)' }}
                        >
                          <SendsLog
                            sends={sendsQuery.data}
                            isLoading={sendsQuery.isLoading}
                            isError={sendsQuery.isError}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AutomationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        onSaved={() => {
          setFormOpen(false);
          invalidate();
        }}
      />

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('deleteTitle', { name: deleteTarget?.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('deleteDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SendsLog({
  sends,
  isLoading,
  isError,
}: {
  sends: InstagramAutomationSend[] | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t, i18n } = useTranslation('automations');
  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <Spinner size="sm" />
      </div>
    );
  }
  if (isError) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>
        {t('sendsLoadError')}
      </p>
    );
  }
  if (!sends || sends.length === 0) {
    return (
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', padding: '0.5rem 0' }}>
        {t('sendsEmpty')}
      </p>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 6, padding: '0.5rem 0' }}>
      {sends.map((s) => {
        return (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-2"
            style={{ fontSize: '0.8rem' }}
          >
            <Badge variant={SEND_STATUS_VARIANT[s.status]} size="sm">
              {t(`sendStatus.${s.status}`)}
            </Badge>
            <span style={{ fontWeight: 600 }}>
              @{s.commenter_username ?? t('unknownCommenter')}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>
              {formatDate(s.comment_created_at, i18n.language)}
            </span>
            {s.comment_text && (
              <span style={{ color: 'var(--text-muted)' }}>"{truncate(s.comment_text, 80)}"</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
