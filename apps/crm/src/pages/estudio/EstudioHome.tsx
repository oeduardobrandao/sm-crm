import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ImageIcon,
  Link2,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  Unlink,
  Copy,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  deleteDesign,
  detachDesign,
  duplicateDesign,
  fetchAttachedThumbSources,
  getClientes,
  listDesigns,
  pickThumbKey,
  type DesignSummary,
} from '@/store';
import { resolveInlineImageUrls } from '@/services/inlineImage';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { NewDesignDialog } from './NewDesignDialog';
import { ApplyToPostDialog } from './ApplyToPostDialog';

// Estúdio home (design-first slice A2): the design gallery. Reads are plain RLS queries;
// every action goes through the design-manage wrappers in store/designs.ts.

function statusChip(
  d: DesignSummary,
  t: (k: string) => string,
): { label: string; cls: string } | null {
  if (d.render_status === 'failed')
    return { label: t('home.renderFailed'), cls: 'badge badge-danger' };
  if (d.render_status !== 'rendered' || d.is_stale)
    return { label: t('home.generating'), cls: 'badge badge-neutral' };
  return null;
}

export function EstudioHome() {
  const navigate = useNavigate();
  const { t } = useTranslation('estudio');
  const qc = useQueryClient();
  const { features } = useWorkspaceLimits();
  const estudioBlocked = features?.feature_estudio === false;

  const [clienteFilter, setClienteFilter] = useState<number | undefined>(undefined);
  const [newOpen, setNewOpen] = useState(false);
  const [applyTarget, setApplyTarget] = useState<DesignSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DesignSummary | null>(null);

  const designsQuery = useQuery({
    queryKey: ['designs', clienteFilter ?? 'all'],
    queryFn: () => listDesigns(clienteFilter),
    enabled: !estudioBlocked,
  });
  const designs = designsQuery.data ?? [];

  const clientesQuery = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const clienteName = (id: number | null) =>
    id === null ? null : (clientesQuery.data?.find((c) => c.id === id)?.nome ?? null);

  // One dependent query resolves every card thumbnail: attached posts' media sources in one
  // RLS read, then one signed-URL batch. Keyed on rev/status so fresh renders refresh it.
  const thumbsQuery = useQuery({
    queryKey: [
      'design-thumbs',
      designs.map((d) => `${d.id}:${d.rev}:${d.render_status}:${d.post_id}`).join(','),
    ],
    enabled: designs.length > 0,
    queryFn: async () => {
      const attached = await fetchAttachedThumbSources(
        designs.filter((d) => d.post_id !== null).map((d) => d.post_id as number),
      );
      const keyByDesign = new Map<number, string | null>(
        designs.map((d) => [
          d.id,
          pickThumbKey(d, d.post_id !== null ? attached.get(d.post_id) : undefined),
        ]),
      );
      const keys = [...new Set([...keyByDesign.values()].filter((k): k is string => !!k))];
      const urls = await resolveInlineImageUrls(keys);
      return { keyByDesign, urls };
    },
  });
  const thumbUrl = (d: DesignSummary): string | undefined => {
    const key = thumbsQuery.data?.keyByDesign.get(d.id);
    return key ? thumbsQuery.data?.urls[key] : undefined;
  };

  const invalidate = (d: DesignSummary) => {
    void qc.invalidateQueries({ queryKey: ['designs'] });
    if (d.post_id !== null) {
      void qc.invalidateQueries({ queryKey: ['post-design-summary', d.post_id] });
    }
  };

  const duplicateMutation = useMutation({
    mutationFn: (d: DesignSummary) => duplicateDesign(d.id),
    onSuccess: ({ design_id }) => {
      toast.success(t('home.duplicated'));
      navigate(`/estudio/${design_id}`);
    },
    onError: (err: Error) => toast.error(t('toast.createError', { error: err.message })),
  });

  const detachMutation = useMutation({
    mutationFn: (d: DesignSummary) => detachDesign(d.id),
    onSuccess: (_res, d) => {
      toast.success(t('home.detachDone'));
      invalidate(d);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (d: DesignSummary) => deleteDesign(d.id),
    onSuccess: (_res, d) => {
      setDeleteTarget(null);
      invalidate(d);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (estudioBlocked) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)', maxWidth: '28rem', textAlign: 'center' }}>
          {t('featureBlocked')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '1.5rem' }} className="animate-up">
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1.5rem',
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '2rem',
              fontWeight: 900,
              color: 'var(--text-main)',
            }}
          >
            {t('title')}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <Select
            value={clienteFilter === undefined ? 'all' : String(clienteFilter)}
            onValueChange={(v) => setClienteFilter(v === 'all' ? undefined : parseInt(v, 10))}
          >
            <SelectTrigger style={{ minWidth: '12rem' }} data-testid="client-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('home.allClients')}</SelectItem>
              {(clientesQuery.data ?? [])
                .filter((c) => c.id !== undefined)
                .map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.nome}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('home.newDesign')}
          </Button>
        </div>
      </div>

      {designsQuery.isLoading ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: '4rem' }}>
          <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : designs.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem' }}
        >
          <p style={{ marginBottom: '1rem' }}>{t('home.empty')}</p>
          <Button onClick={() => setNewOpen(true)}>{t('home.emptyCta')}</Button>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: '1rem',
          }}
        >
          {designs.map((d) => {
            const chip = statusChip(d, t);
            const url = thumbUrl(d);
            return (
              <div
                key={d.id}
                data-testid={`design-card-${d.id}`}
                className="card"
                style={{ padding: 0, overflow: 'hidden', cursor: 'pointer', borderRadius: 16 }}
                onClick={() => navigate(`/estudio/${d.id}`)}
              >
                <div
                  style={{
                    aspectRatio: d.format === 'reel_cover' ? '9 / 14' : '4 / 5',
                    maxHeight: 260,
                    width: '100%',
                    background: 'var(--surface-darker)',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={d.name}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8" style={{ color: 'var(--text-light)' }} />
                  )}
                </div>
                <div style={{ padding: '0.75rem 0.9rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '0.5rem',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        color: 'var(--text-main)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {d.name}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={t('home.cardMenu')}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center justify-center rounded-md"
                          style={{ width: 26, height: 26, color: 'var(--text-muted)' }}
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => navigate(`/estudio/${d.id}`)}>
                          <Pencil className="h-3.5 w-3.5" /> {t('home.actions.open')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={duplicateMutation.isPending}
                          onClick={() => duplicateMutation.mutate(d)}
                        >
                          <Copy className="h-3.5 w-3.5" /> {t('home.actions.duplicate')}
                        </DropdownMenuItem>
                        {d.post_id === null ? (
                          <DropdownMenuItem onClick={() => setApplyTarget(d)}>
                            <Link2 className="h-3.5 w-3.5" /> {t('home.actions.apply')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={detachMutation.isPending}
                            onClick={() => detachMutation.mutate(d)}
                          >
                            <Unlink className="h-3.5 w-3.5" /> {t('home.actions.detach')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setDeleteTarget(d)}
                          style={{ color: 'var(--danger)' }}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> {t('home.actions.delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      marginTop: '0.35rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="badge badge-neutral">{t(`home.formats.${d.format}`)}</span>
                    {chip && <span className={chip.cls}>{chip.label}</span>}
                    {d.post_id !== null && (
                      <span
                        style={{
                          fontSize: '0.65rem',
                          color: 'var(--text-light)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Link2 className="h-3 w-3" /> {t('home.attachedTo', { id: d.post_id })}
                      </span>
                    )}
                  </div>
                  {clienteName(d.cliente_id) && (
                    <p
                      style={{
                        fontSize: '0.7rem',
                        color: 'var(--text-muted)',
                        marginTop: '0.3rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {clienteName(d.cliente_id)}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewDesignDialog open={newOpen} onOpenChange={setNewOpen} />
      <ApplyToPostDialog
        design={applyTarget}
        onClose={() => setApplyTarget(null)}
        onApplied={(d) => {
          setApplyTarget(null);
          invalidate(d);
        }}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('home.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('home.deleteConfirmBody', { name: deleteTarget?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('home.deleteCancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget)}
            >
              {t('home.deleteConfirmCta')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
