import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL } from '@/lib/financialAccess';
import {
  getEntregasManuais,
  getPeriodosEditaveis,
  getRentabilidade,
  salvarEntregas,
  type EntregaItem,
} from '@/store';
import { PeriodoSelect } from '../financeiro/v2/PeriodoSelect';
import { useAcordoAtual } from './acordoHelpers';
import { avisarErroFinanceiro } from '../financeiro/v2/erros';
import { periodoPadrao } from '../financeiro/v2/periodos';

/** '' is an empty entry (null); anything else must be a whole number from 0 up. */
function parseQuantidade(texto: string): number | null | 'invalida' {
  const t = texto.trim();
  if (t === '') return null;
  if (!/^\d+$/.test(t)) return 'invalida';
  return Number(t);
}

/**
 * Monthly count of deliveries per client for a member paid per delivery. The numbers feed
 * the member's cost in the rentabilidade of the chosen period.
 */
export function EntregasManuaisCard({ membroId }: { membroId: number }) {
  const qc = useQueryClient();
  const { canSeeFinancials, profile } = useAuth();
  const { atual } = useAcordoAtual(membroId);
  const porEntrega = atual?.modelo === 'por_entrega';

  const editaveis = useQuery({
    queryKey: ['financeiro-v2', 'editaveis'],
    queryFn: getPeriodosEditaveis,
    enabled: porEntrega,
  });
  const periodos = editaveis.data ?? [];
  const [escolhido, setEscolhido] = useState<string | undefined>();
  const inicio = escolhido ?? periodoPadrao(periodos)?.inicio;

  const rent = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', inicio],
    queryFn: () => getRentabilidade(inicio),
    enabled: porEntrega && !!inicio,
  });
  const salvas = useQuery({
    queryKey: ['financeiro-v2', 'entregas', inicio, membroId],
    queryFn: () => getEntregasManuais(inicio as string, membroId),
    enabled: porEntrega && !!inicio,
  });

  // Typed text per client; a client without an entry shows its saved quantity.
  const [edicoes, setEdicoes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => setEdicoes({}), [inicio]);

  const quantidadeSalva = (clienteId: number): number | null =>
    salvas.data?.find((s) => s.cliente_id === clienteId)?.quantidade ?? null;

  const linhas = (rent.data?.seeded ? rent.data.clientes : []).flatMap((c) => {
    const pessoa = c.pessoas.find((p) => p.membro_id === membroId);
    return pessoa ? [{ cliente: c, pessoa }] : [];
  });

  const textoDe = (clienteId: number): string =>
    edicoes[clienteId] ?? String(quantidadeSalva(clienteId) ?? '');
  const alteradas = linhas.filter(({ cliente }) => {
    if (edicoes[cliente.cliente_id] === undefined) return false;
    const q = parseQuantidade(edicoes[cliente.cliente_id]);
    return q === 'invalida' || q !== quantidadeSalva(cliente.cliente_id);
  });
  const temInvalida = alteradas.some(
    ({ cliente }) => parseQuantidade(edicoes[cliente.cliente_id]) === 'invalida',
  );
  const dirty = alteradas.length > 0;
  useUnsavedWork(dirty || busy);

  if (!porEntrega || !atual) return null;

  const salvar = async () => {
    if (!inicio || temInvalida) return;
    const itens: EntregaItem[] = alteradas.map(({ cliente }) => ({
      cliente_id: cliente.cliente_id,
      quantidade: parseQuantidade(edicoes[cliente.cliente_id]) as number | null,
    }));
    setBusy(true);
    try {
      await salvarEntregas(inicio, membroId, itens);
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
      setEdicoes({});
      toast.success('Entregas salvas.');
    } catch (e) {
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null)) {
        avisarErroFinanceiro(e, 'Erro ao salvar as entregas', qc);
      }
    } finally {
      setBusy(false);
    }
  };

  const carregando = editaveis.isLoading || rent.isLoading || salvas.isLoading;
  const erro = editaveis.isError || rent.isError || salvas.isError;

  return (
    <section className="card" style={{ marginBottom: '1.5rem' }} aria-label="Entregas do período">
      <h3 style={{ marginBottom: 4 }}>Entregas do período</h3>
      <p className="text-sm text-muted-foreground" style={{ marginBottom: 12 }}>
        Informe quantas entregas cada cliente recebeu neste período.
      </p>

      <div className="flex flex-col gap-2" style={{ marginBottom: 12 }}>
        <Label htmlFor="entregas-periodo">Período</Label>
        {inicio ? (
          <PeriodoSelect
            id="entregas-periodo"
            value={inicio}
            onChange={setEscolhido}
            periodos={periodos}
            ordem="cronologica"
            disabled={busy}
          />
        ) : (
          <Skeleton className="h-9 w-full sm:w-56" />
        )}
      </div>

      {carregando ? (
        <Skeleton className="h-24 w-full" />
      ) : erro ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar as entregas deste período.
        </p>
      ) : linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cliente atribuído neste período.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-2">
            {linhas.map(({ cliente, pessoa }) => {
              const texto = textoDe(cliente.cliente_id);
              const q = parseQuantidade(texto);
              const unitario = pessoa.valor_unitario ?? atual.valor;
              // Deliveries for a paused client still count (they are optional there).
              const pausado = cliente.status === 'pausado';
              return (
                <li key={cliente.cliente_id} className="flex items-center gap-3">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="truncate text-sm">{cliente.nome}</span>
                    {pausado && (
                      <Badge variant="neutral" size="sm">
                        Pausado
                      </Badge>
                    )}
                  </span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    className="w-24"
                    aria-label={`Entregas de ${cliente.nome}`}
                    aria-invalid={q === 'invalida' ? true : undefined}
                    value={texto}
                    onChange={(e) =>
                      setEdicoes((prev) => ({ ...prev, [cliente.cliente_id]: e.target.value }))
                    }
                    disabled={busy}
                  />
                  <span className="w-28 text-right text-sm text-muted-foreground">
                    {typeof q === 'number'
                      ? formatFinancialBRL(q * unitario, canSeeFinancials)
                      : pausado
                        ? '-'
                        : 'A informar'}
                  </span>
                </li>
              );
            })}
          </ul>
          <div style={{ marginTop: 12 }}>
            <Button onClick={salvar} disabled={busy || !dirty || temInvalida}>
              {busy && <Spinner size="sm" />} Salvar entregas
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

export default EntregasManuaisCard;
