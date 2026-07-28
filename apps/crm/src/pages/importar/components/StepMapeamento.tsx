import { AlertTriangle } from 'lucide-react';
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

/**
 * Status of the existing-clientes lookup this step's "existing vs. created"
 * decisions depend on. While it's anything but 'ready', advancing is blocked:
 * an unresolved or failed list silently resolves every referenced name to
 * "created", which the server cannot tell apart from a real instruction to
 * create a duplicate client.
 */
export type ClientesStatus = 'pending' | 'error' | 'ready';

export const DESTINATION_LABELS: Record<Destination, string> = {
  clientes: 'Clientes',
  posts: 'Posts',
  entregas: 'Entregas',
  ideias: 'Ideias',
  ignorar: 'Ignorar',
};

export const STATUS_LABELS: Record<PostStatusTarget, string> = {
  rascunho: 'Rascunho',
  revisao_interna: 'Revisão interna',
  aprovado_interno: 'Aprovado internamente',
  enviado_cliente: 'Enviado ao cliente',
  aprovado_cliente: 'Aprovado pelo cliente',
  correcao_cliente: 'Em correção',
  postado: 'Postado (só para datas passadas)',
};

const FIXED = '__fixo__';

function statusKeys(collection: ImportCollection, mapping: CollectionMapping): string[] {
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
  const update = (collectionId: string, patch: Partial<CollectionMapping>) => {
    onChange({
      collections: proposal.collections.map((m) =>
        m.collectionId === collectionId ? { ...m, ...patch } : m,
      ),
    });
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Confira o que encontramos em cada parte do arquivo. Tudo é editável — nada é importado antes
        da sua confirmação.
      </p>

      {clientesStatus === 'pending' && (
        <div className="flex items-center gap-2 rounded-xl border border-border p-4 text-sm text-muted">
          <Spinner size="sm" /> Carregando a lista de clientes existentes — precisamos dela para
          saber quem já é seu cliente antes de continuar.
        </div>
      )}

      {clientesStatus === 'error' && (
        <div className="flex flex-col gap-3 rounded-xl border border-danger/40 bg-danger/5 p-4 text-sm text-danger sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p>
              Não foi possível carregar a lista de clientes existentes. Continuar sem ela pode
              duplicar um cliente que já existe.
            </p>
          </div>
          <Button variant="secondary" onClick={onRetryClientes}>
            Tentar novamente
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
                <p className="text-xs text-muted">
                  {collection.rows.length} {collection.rows.length === 1 ? 'linha' : 'linhas'} ·{' '}
                  {collection.columns.length}{' '}
                  {collection.columns.length === 1 ? 'coluna' : 'colunas'}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <span className="text-xs font-semibold uppercase text-muted">Importar como</span>
                  <Select
                    value={mapping.destination}
                    onValueChange={(v) => update(collection.id, { destination: v as Destination })}
                  >
                    <SelectTrigger aria-label={`Destino de ${collection.name}`}>
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
                    <span className="text-xs font-semibold uppercase text-muted">Cliente</span>
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
                      <SelectTrigger aria-label={`Cliente de ${collection.name}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={FIXED}>Um cliente para todas as linhas</SelectItem>
                        {collection.columns.map((c) => (
                          <SelectItem key={c} value={c}>
                            Coluna “{c}”
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {assignment.mode === 'fixed' && (
                      <>
                        <Input
                          aria-label={`Nome do cliente de ${collection.name}`}
                          value={assignment.clienteNome}
                          placeholder="Nome do cliente"
                          onChange={(e) =>
                            update(collection.id, {
                              clientAssignment: { mode: 'fixed', clienteNome: e.target.value },
                            })
                          }
                        />
                        <p className="text-xs text-muted">
                          {fixedMatch
                            ? 'Usaremos o cliente que já existe com esse nome.'
                            : 'Se não existir um cliente com esse nome, ele será criado.'}
                        </p>
                      </>
                    )}
                  </div>
                )}
              </div>

              {keys.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold uppercase text-muted">
                    Equivalência de status
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
                            aria-label={`Status "${key}" de ${collection.name}`}
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
          Voltar
        </Button>
        <Button disabled={clientesStatus !== 'ready'} onClick={onNext}>
          Continuar
        </Button>
      </div>
    </div>
  );
}
