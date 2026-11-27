import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  POST_STATUS_TARGETS,
  type CollectionMapping,
  type Destination,
  type ImportBundle,
  type ImportCollection,
  type MappingProposal,
  type PostStatusTarget,
} from '@mesaas/import-parsers';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { norm, type ExistingCliente } from '../buildCommitRows';
import { lazyLabels } from '@/pages/entregas/postLabels';

/**
 * Status of the existing-clientes lookup this step's "existing vs. created"
 * decisions depend on. While it's anything but 'ready', advancing is blocked:
 * an unresolved or failed list silently resolves every referenced name to
 * "created", which the server cannot tell apart from a real instruction to
 * create a duplicate client.
 */
export type ClientesStatus = 'pending' | 'error' | 'ready';

/** Resolved through i18n on every read, so it follows the UI language. */
export const DESTINATION_LABELS: Record<Destination, string> = lazyLabels(
  ['clientes', 'posts', 'entregas', 'ideias', 'ignorar'] as const,
  (k) => `importWizard:destination.${k}`,
);

export const STATUS_LABELS: Record<PostStatusTarget, string> = lazyLabels(
  POST_STATUS_TARGETS,
  (k) => `importWizard:status.${k}`,
);

const FIXED = '__fixo__';

export function statusKeys(collection: ImportCollection, mapping: CollectionMapping): string[] {
  if (collection.listNames.length) return collection.listNames;
  const column = mapping.columnRoles.status;
  if (!column) return [];
  return [...new Set(collection.rows.map((r) => (r.cells[column] ?? '').trim()).filter(Boolean))];
}

export default function StepMapeamento({
  bundle,
  proposal,
  clientes,
  clientesStatus,
  onRetryClientes,
  error,
  onChange,
  onBack,
  onNext,
}: {
  bundle: ImportBundle;
  proposal: MappingProposal;
  clientes: ExistingCliente[];
  clientesStatus: ClientesStatus;
  onRetryClientes: () => void;
  error: string | null;
  onChange: (proposal: MappingProposal) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { t } = useTranslation('importWizard');
  const update = (collectionId: string, patch: Partial<CollectionMapping>) => {
    onChange({
      collections: proposal.collections.map((m) =>
        m.collectionId === collectionId ? { ...m, ...patch } : m,
      ),
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('mapping.lead')}</p>

      {clientesStatus === 'pending' && (
        <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted-foreground">
          <Spinner size="sm" /> {t('mapping.loadingClients')}
        </div>
      )}

      {clientesStatus === 'error' && (
        <div className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>{t('mapping.clientsError')}</p>
          </div>
          <Button variant="secondary" onClick={onRetryClientes}>
            {t('mapping.retry')}
          </Button>
        </div>
      )}

      {bundle.collections.map((collection) => {
        const mapping = proposal.collections.find((m) => m.collectionId === collection.id);
        if (!mapping) return null;
        const needsClient = mapping.destination !== 'clientes' && mapping.destination !== 'ignorar';
        const assignment = mapping.clientAssignment;
        const fixedMatch =
          assignment.mode === 'fixed'
            ? clientes.find((c) => norm(c.nome) === norm(assignment.clienteNome))
            : undefined;
        const keys = mapping.destination === 'posts' ? statusKeys(collection, mapping) : [];

        return (
          <Card key={collection.id}>
            <CardContent className="space-y-4 pt-6">
              <div>
                <h2 className="text-base font-semibold">{collection.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {t('count.row', { count: collection.rows.length })} ·{' '}
                  {t('count.column', { count: collection.columns.length })}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    {t('mapping.importAs')}
                  </span>
                  <Select
                    value={mapping.destination}
                    onValueChange={(v) => update(collection.id, { destination: v as Destination })}
                  >
                    <SelectTrigger
                      aria-label={t('mapping.destinationOf', { name: collection.name })}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(DESTINATION_LABELS) as Destination[]).map((d) => (
                        <SelectItem key={d} value={d}>
                          {DESTINATION_LABELS[d]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {needsClient && (
                  <div className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-muted-foreground">
                      {t('mapping.client')}
                    </span>
                    <Select
                      value={assignment.mode === 'column' ? assignment.column : FIXED}
                      onValueChange={(v) =>
                        update(collection.id, {
                          clientAssignment:
                            v === FIXED
                              ? { mode: 'fixed', clienteNome: '' }
                              : { mode: 'column', column: v },
                        })
                      }
                    >
                      <SelectTrigger aria-label={t('mapping.clientOf', { name: collection.name })}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FIXED}>{t('mapping.oneClientForAll')}</SelectItem>
                        {collection.columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            {t('mapping.column', { name: c })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {assignment.mode === 'fixed' && (
                      <>
                        <Input
                          aria-label={t('mapping.clientNameOf', { name: collection.name })}
                          value={assignment.clienteNome}
                          placeholder={t('mapping.clientName')}
                          onChange={(e) =>
                            update(collection.id, {
                              clientAssignment: { mode: 'fixed', clienteNome: e.target.value },
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          {fixedMatch ? t('mapping.willUseExisting') : t('mapping.willCreate')}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {keys.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase text-muted-foreground">
                    {t('mapping.statusMap')}
                  </span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {keys.map((key) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="w-1/2 truncate text-sm" title={key}>
                          {key}
                        </span>
                        <Select
                          value={mapping.statusMap[key] ?? 'rascunho'}
                          onValueChange={(v) =>
                            update(collection.id, {
                              statusMap: { ...mapping.statusMap, [key]: v as PostStatusTarget },
                            })
                          }
                        >
                          <SelectTrigger
                            aria-label={t('mapping.statusAria', { key, name: collection.name })}
                            className="w-1/2"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {POST_STATUS_TARGETS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {error && (
        <div className="flex gap-2 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{error}</p>
        </div>
      )}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button disabled={clientesStatus !== 'ready'} onClick={onNext}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  );
}
