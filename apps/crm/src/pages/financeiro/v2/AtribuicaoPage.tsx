import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { useAuth } from '@/context/AuthContext';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { formatFinancialBRL, type FinancialAccess } from '@/lib/financialAccess';
import { cn } from '@/lib/utils';
import { getPeriodosEditaveis, getRentabilidade, salvarAtribuicoes } from '@/store';
import type {
  AtribuicaoMudanca,
  ClienteRentabilidade,
  MembroRentabilidade,
  RentabilidadeSeeded,
} from '@/store/financeiroV2';
import { formatMargem } from './format';
import { PeriodoSelect } from './PeriodoSelect';
import { avisarErroFinanceiro } from './erros';
import { periodoPadrao } from './periodos';

const chave = (membroId: number, clienteId: number) => `${membroId}:${clienteId}`;

// First column stays put while the matrix scrolls sideways on a phone. Sticky works here
// because the scroll box is the table's own `overflow-x: auto` wrapper, not the page.
const PRIMEIRA_COLUNA = 'sticky left-0 z-[1] bg-card text-left';

/**
 * "Equipe por cliente": who works on which client. Each member's monthly cost is split
 * evenly across the clients ticked in their column. Every toggle saves on its own
 * (`salvarAtribuicoes`) from the period picked in "Alterações valem a partir de", and
 * the grid reads the rentabilidade of that same period, so what you see is what that
 * period becomes.
 */
export default function AtribuicaoPage() {
  const { can, canSeeFinancials } = useAuth();
  const podeEditar = can('financeiro', 'editar') === true;
  const [escolhido, setEscolhido] = useState<string>();

  const editaveis = useQuery({
    queryKey: ['financeiro-v2', 'editaveis'],
    queryFn: getPeriodosEditaveis,
  });
  const periodos = useMemo(() => editaveis.data ?? [], [editaveis.data]);
  // Derived rather than seeded into state: invalidating ['financeiro-v2'] refetches the
  // list too, and an effect-set default would overwrite the user's pick.
  const padrao = periodoPadrao(periodos)?.inicio;
  const valeDesde = escolhido && periodos.some((p) => p.inicio === escolhido) ? escolhido : padrao;
  const periodo = periodos.find((p) => p.inicio === valeDesde);

  const rentabilidade = useQuery({
    queryKey: ['financeiro-v2', 'rentabilidade', valeDesde],
    queryFn: () => getRentabilidade(valeDesde),
    enabled: !!valeDesde,
  });

  const tentarNovamente = () => {
    if (editaveis.isError) void editaveis.refetch();
    if (rentabilidade.isError) void rentabilidade.refetch();
  };
  // A failed background refetch (after a save, on focus) keeps the cached data: the grid
  // stays mounted with its in-flight and optimistic state, under a small warning. The
  // full error only stands in for the grid when there is nothing to show.
  const semDados =
    (editaveis.isError && !editaveis.data) || (rentabilidade.isError && !rentabilidade.data);
  const refetchFalhou = !semDados && (editaveis.isError || rentabilidade.isError);

  let corpo: React.ReactNode;
  if (semDados) {
    // The period select above stays rendered, so a failed pick is never a dead end.
    corpo = (
      <div className="flex flex-wrap items-center gap-2">
        <Aviso>Não foi possível carregar a equipe por cliente.</Aviso>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mb-0"
          onClick={tentarNovamente}
        >
          Tentar novamente
        </Button>
        {valeDesde !== padrao && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mb-0"
            onClick={() => setEscolhido(undefined)}
          >
            Voltar ao período atual
          </Button>
        )}
      </div>
    );
  } else if (editaveis.isLoading || (valeDesde && rentabilidade.isLoading)) {
    corpo = <Aviso>Carregando…</Aviso>;
  } else if (!valeDesde) {
    corpo = <Aviso>Nenhum período aberto para alterações.</Aviso>;
  } else if (!rentabilidade.data?.seeded) {
    corpo = <Aviso>O financeiro ainda não foi montado.</Aviso>;
  } else {
    corpo = (
      <Matriz
        // A new period starts from a clean slate of optimistic state.
        key={valeDesde}
        data={rentabilidade.data}
        dataUpdatedAt={rentabilidade.dataUpdatedAt}
        valeDesde={valeDesde}
        podeEditar={podeEditar}
        access={canSeeFinancials}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1">
          <h2 className="m-0 text-xl font-semibold">Equipe por cliente</h2>
          <p className="m-0 text-sm text-muted-foreground">
            Marque quem atende cada cliente. O custo mensal de cada pessoa é dividido igualmente
            entre os clientes marcados.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="atribuicao-vale-desde">Alterações valem a partir de</Label>
          <PeriodoSelect
            id="atribuicao-vale-desde"
            // '' (not undefined) while loading keeps the Radix Select controlled throughout.
            value={valeDesde ?? ''}
            onChange={setEscolhido}
            periodos={periodos}
            ordem="cronologica"
            disabled={periodos.length === 0}
          />
          {periodo?.status === 'reaberto' && (
            <p className="m-0 text-xs text-muted-foreground">
              Os períodos seguintes já fechados não mudam
            </p>
          )}
        </div>
      </div>
      {refetchFalhou && (
        <div role="status" className="flex flex-wrap items-center gap-2">
          <Aviso>Não foi possível atualizar os dados. Os valores podem estar desatualizados.</Aviso>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-0"
            onClick={tentarNovamente}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      {corpo}
    </section>
  );
}

function Aviso({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-sm text-muted-foreground">{children}</p>;
}

interface MatrizProps {
  data: RentabilidadeSeeded;
  /** When `data` last came back from a successful fetch. */
  dataUpdatedAt: number;
  valeDesde: string;
  podeEditar: boolean;
  access: FinancialAccess;
}

function Matriz({ data, dataUpdatedAt, valeDesde, podeEditar, access }: MatrizProps) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  // Optimistic checked state per `membro:cliente`, shown until the refetch lands.
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());
  // Cells whose own save is in flight (disabled meanwhile; the rest stay usable).
  const [pendentes, setPendentes] = useState<Set<string>>(() => new Set());
  // Bumped on every toggle of a key, so a slow save never clears a newer override.
  const versoes = useRef(new Map<string, number>());
  // A "Marcar todos" save has no focused or changed control for the silent-update
  // heuristic to see, so the in-flight saves are registered explicitly.
  useUnsavedWork(pendentes.size > 0);
  // Keys whose save landed but whose own post-save refetch has not answered yet (a count,
  // since one key can have two such saves). A fetch landing meanwhile may predate the write.
  const aguardandoRefetch = useRef(new Map<string, number>());
  const ultimaResposta = useRef(dataUpdatedAt);

  // Any successful fetch is server truth for every key not waiting on a save of its own.
  // This is what drops an override kept because its post-save refetch failed: the next
  // good answer (Tentar novamente, a focus refetch, another save) wins over it.
  useEffect(() => {
    if (dataUpdatedAt === ultimaResposta.current) return;
    ultimaResposta.current = dataUpdatedAt;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const k of prev.keys()) {
        if (!pendentes.has(k) && !aguardandoRefetch.current.has(k)) next.delete(k);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [dataUpdatedAt, pendentes]);

  const grupos = useMemo(
    () =>
      data.funcoes
        .map((f) => ({ funcao: f, membros: data.membros.filter((m) => m.funcao_id === f.id) }))
        .filter((g) => g.membros.length > 0),
    [data],
  );
  const colunas = useMemo(() => grupos.flatMap((g) => g.membros), [grupos]);
  const semFuncao = useMemo(
    () =>
      data.membros.filter(
        (m) => m.funcao_id === null || !data.funcoes.some((f) => f.id === m.funcao_id),
      ),
    [data],
  );
  const doServidor = useMemo(() => {
    const s = new Set<string>();
    for (const c of data.clientes)
      for (const p of c.pessoas) s.add(chave(p.membro_id, c.cliente_id));
    return s;
  }, [data]);

  const marcado = (m: MembroRentabilidade, c: ClienteRentabilidade) => {
    const k = chave(m.membro_id, c.cliente_id);
    return overrides.get(k) ?? doServidor.has(k);
  };

  function limpar(chaves: string[], versao: Map<string, number>) {
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const k of chaves) if (versoes.current.get(k) === versao.get(k)) next.delete(k);
      return next;
    });
  }

  async function salvar(mudancas: AtribuicaoMudanca[]) {
    const chaves = mudancas.map((m) => chave(m.membro_id, m.cliente_id));
    const versao = new Map<string, number>();
    for (const k of chaves) {
      const v = (versoes.current.get(k) ?? 0) + 1;
      versoes.current.set(k, v);
      versao.set(k, v);
    }
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const m of mudancas) next.set(chave(m.membro_id, m.cliente_id), m.ativo);
      return next;
    });
    setPendentes((prev) => new Set([...prev, ...chaves]));
    const soltar = () =>
      setPendentes((prev) => {
        const next = new Set(prev);
        for (const k of chaves) next.delete(k);
        return next;
      });

    try {
      await salvarAtribuicoes(valeDesde, mudancas);
    } catch (e) {
      soltar();
      limpar(chaves, versao);
      // handleEntitlementMutationError shows the upgrade toast itself; only fall back to
      // the generic one when the error is not an entitlement denial.
      if (!handleEntitlementMutationError(e, profile?.conta_id ?? null)) {
        avisarErroFinanceiro(e, 'Não foi possível salvar', qc);
      }
      return;
    }
    const aguardando = aguardandoRefetch.current;
    for (const k of chaves) aguardando.set(k, (aguardando.get(k) ?? 0) + 1);
    soltar();
    try {
      await qc.invalidateQueries({ queryKey: ['financeiro-v2'] });
    } finally {
      for (const k of chaves) {
        const n = (aguardando.get(k) ?? 1) - 1;
        if (n > 0) aguardando.set(k, n);
        else aguardando.delete(k);
      }
    }
    // The refetch has landed: from here the server's answer is the truth. If it failed,
    // the cached data predates the write that did land, so the override stays until the
    // next successful fetch (see the effect above).
    if (qc.getQueryState(['financeiro-v2', 'rentabilidade', valeDesde])?.status === 'error') return;
    limpar(chaves, versao);
  }

  function marcarTodos(m: MembroRentabilidade) {
    const mudancas = alvosDeMarcarTodos(m);
    if (mudancas.length === 0) return;
    void salvar(mudancas);
  }

  function alvosDeMarcarTodos(m: MembroRentabilidade): AtribuicaoMudanca[] {
    return data.clientes
      .filter(
        (c) =>
          c.status === 'ativo' &&
          !marcado(m, c) &&
          !pendentes.has(chave(m.membro_id, c.cliente_id)),
      )
      .map((c) => ({ membro_id: m.membro_id, cliente_id: c.cliente_id, ativo: true }));
  }

  const n = semFuncao.length;
  const semFuncaoTexto =
    n === 1
      ? '1 pessoa sem função não entra no rateio'
      : `${n} pessoas sem função não entram no rateio`;

  return (
    <div className="flex flex-col gap-3">
      {n > 0 && (
        <div
          role="status"
          className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          <span className="font-medium text-foreground">{semFuncaoTexto}</span>. Defina a função no
          acordo:{' '}
          {semFuncao.map((m, i) => (
            <span key={m.membro_id}>
              {i > 0 && ', '}
              <Link to={`/equipe/${m.membro_id}`} className="font-medium underline">
                {m.nome}
              </Link>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] tabular-nums">
            <thead>
              <tr>
                <th className={cn(PRIMEIRA_COLUNA, 'px-3 pb-0.5 pt-2')} />
                {grupos.map((g) => (
                  <th
                    key={g.funcao.id}
                    colSpan={g.membros.length}
                    scope="colgroup"
                    className="border-l border-border px-3 pb-0.5 pt-2 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {g.funcao.nome}
                  </th>
                ))}
                <th colSpan={2} className="border-l border-border" />
              </tr>
              <tr className="border-b border-border align-bottom">
                <th
                  scope="col"
                  className={cn(
                    PRIMEIRA_COLUNA,
                    'px-3 py-2 text-xs font-medium text-muted-foreground',
                  )}
                >
                  Cliente
                </th>
                {colunas.map((m, i) => {
                  const alvos = podeEditar ? alvosDeMarcarTodos(m) : [];
                  return (
                    <th
                      key={m.membro_id}
                      scope="col"
                      className={cn(
                        'px-3 py-2 font-normal',
                        inicioDeGrupo(colunas, i) && 'border-l border-border',
                      )}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <PessoaAvatar nome={m.nome} seed={m.membro_id} size={32} />
                        <span className="whitespace-nowrap text-[13px] font-semibold">
                          {m.nome}
                        </span>
                        <span className="whitespace-nowrap text-[11px] text-muted-foreground">
                          {formatFinancialBRL(m.custo, access)} por mês
                        </span>
                        {podeEditar && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mb-0 h-7 px-2 text-[11px]"
                            aria-label={`Marcar todos para ${m.nome}`}
                            disabled={alvos.length === 0}
                            onClick={() => marcarTodos(m)}
                          >
                            Marcar todos
                          </Button>
                        )}
                      </div>
                    </th>
                  );
                })}
                <th
                  scope="col"
                  className="whitespace-nowrap border-l border-border px-3 py-2 text-right text-xs font-medium text-muted-foreground"
                >
                  Custo
                </th>
                <th
                  scope="col"
                  className="whitespace-nowrap px-3 py-2 text-right text-xs font-medium text-muted-foreground"
                >
                  Margem
                </th>
              </tr>
            </thead>
            <tbody>
              {data.clientes.map((c) => {
                const pausado = c.status === 'pausado';
                return (
                  <tr key={c.cliente_id} className="border-b border-border">
                    <th scope="row" className={cn(PRIMEIRA_COLUNA, 'px-3 py-1 font-semibold')}>
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        {c.nome}
                        {pausado && (
                          <Badge variant="neutral" size="sm">
                            Pausado
                          </Badge>
                        )}
                      </span>
                    </th>
                    {colunas.map((m, i) => {
                      const k = chave(m.membro_id, c.cliente_id);
                      const desabilitado = !podeEditar || pausado || pendentes.has(k);
                      return (
                        <td
                          key={m.membro_id}
                          className={cn(
                            'px-1 py-0 text-center',
                            inicioDeGrupo(colunas, i) && 'border-l border-border',
                          )}
                        >
                          <label
                            className={cn(
                              'inline-flex h-9 w-11 items-center justify-center rounded-lg',
                              desabilitado
                                ? 'cursor-not-allowed opacity-60'
                                : 'cursor-pointer hover:bg-accent',
                            )}
                          >
                            <input
                              type="checkbox"
                              className="m-0 size-[18px] cursor-[inherit] accent-primary"
                              aria-label={`${m.nome} atende ${c.nome}`}
                              checked={marcado(m, c)}
                              disabled={desabilitado}
                              onChange={(e) =>
                                void salvar([
                                  {
                                    membro_id: m.membro_id,
                                    cliente_id: c.cliente_id,
                                    ativo: e.target.checked,
                                  },
                                ])
                              }
                            />
                          </label>
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap border-l border-border px-3 py-1 text-right font-semibold">
                      {pausado ? '-' : formatFinancialBRL(c.custo, access)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1 text-right font-semibold">
                      {formatMargem(c.margem)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-muted/40 text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th
                  scope="row"
                  className={cn(
                    PRIMEIRA_COLUNA,
                    'bg-muted px-3 py-2 font-semibold text-foreground',
                  )}
                >
                  Clientes
                </th>
                {colunas.map((m, i) => (
                  <td
                    key={m.membro_id}
                    className={cn(
                      'px-3 py-2 text-center',
                      inicioDeGrupo(colunas, i) && 'border-l border-border',
                    )}
                  >
                    <ContagemClientes membro={m} />
                  </td>
                ))}
                <td colSpan={2} className="border-l border-border" />
              </tr>
              <tr>
                <th
                  scope="row"
                  className={cn(
                    PRIMEIRA_COLUNA,
                    'bg-muted px-3 py-2 font-semibold text-foreground',
                  )}
                >
                  Por cliente
                </th>
                {colunas.map((m, i) => (
                  <td
                    key={m.membro_id}
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-center font-semibold text-foreground',
                      inicioDeGrupo(colunas, i) && 'border-l border-border',
                    )}
                  >
                    {m.n_clientes === 0 || m.por_cliente === null
                      ? '-'
                      : formatFinancialBRL(m.por_cliente, access)}
                  </td>
                ))}
                <td colSpan={2} className="border-l border-border" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Whether column `i` opens a função group (it gets the group's left rule). */
function inicioDeGrupo(colunas: MembroRentabilidade[], i: number) {
  return i === 0 || colunas[i - 1].funcao_id !== colunas[i].funcao_id;
}

function ContagemClientes({ membro: m }: { membro: MembroRentabilidade }) {
  if (m.modelo !== 'mensal_limite' || m.limite_clientes === null) {
    return <span className="font-semibold text-foreground">{m.n_clientes}</span>;
  }
  const limite = m.limite_clientes;
  const rotulo = `${m.n_clientes} de ${limite}`;
  // Radix Progress rejects a value above max, so an over-limit column caps the bar at 100.
  const uso = limite > 0 ? Math.min(100, Math.round((m.n_clientes / limite) * 100)) : 100;
  return (
    <div className="flex min-w-24 flex-col items-center gap-1">
      <span className="font-semibold text-foreground">{rotulo}</span>
      <Progress value={uso} aria-label={`${rotulo} clientes`} className="h-1.5 w-24" />
      {m.n_clientes > limite && (
        <Badge variant="warning" size="sm">
          Acima do limite
        </Badge>
      )}
    </div>
  );
}
