import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getActivePosts,
  getClientes,
  getMembros,
  getVigentePostProcesses,
  getWorkflows,
  type ActivePost,
  type Cliente,
  type Membro,
  type PostProcessWithPost,
  type Workflow,
  type WorkflowEtapa,
} from '../../../store';
import { buildBoardCards, fetchEtapasMap, type BoardCard } from './useEntregasData';
import { toPostEntity, type PostEntity } from '../boardEntity';

/**
 * Dados mínimos para buildMinhaFila fora de Entregas (teaser do Dashboard).
 * Observa as MESMAS seis chaves que useEntregasData/useActivePosts, com o
 * mesmo queryFn (fetchEtapasMap para ['all-active-etapas']: o cache é por
 * chave, e a forma tem de ser a mesma para todo observer). staleTime só aqui:
 * a volta ao Dashboard não refaz tudo; Entregas mantém o padrão dela.
 */
export interface UseMinhaFilaDataOptions {
  enabled: boolean;
}

export interface MinhaFilaData {
  cards: BoardCard[];
  posts: ActivePost[];
  postEntities: PostEntity[];
  /**
   * Controller decision 1: `isPending` semantics (no data AND no error yet),
   * gated by `enabled` -- a disabled TanStack v5 query reports
   * `status: 'pending'`/`isPending: true` with no fetch in flight, so a bare
   * OR of `isPending` would report loading even while every query is
   * disabled. `enabled && ...` keeps a paused/offline cold start (data-less,
   * error-less, `enabled: true`) reporting loading instead of falling
   * through to the empty state.
   */
  isLoading: boolean;
  /**
   * Controller decision 1: OR of the six queries' `isLoadingError` (failed
   * AND no cached data). A failed background refetch that still has cached
   * data does NOT flip this to true, so the rows stay up.
   */
  isError: boolean;
}

const STALE_MS = 60_000;
const EMPTY_WORKFLOWS: Workflow[] = [];
const EMPTY_CLIENTES: Cliente[] = [];
const EMPTY_MEMBROS: Membro[] = [];
const EMPTY_POSTS: ActivePost[] = [];
const EMPTY_PROCESSES: PostProcessWithPost[] = [];
const EMPTY_CARDS: BoardCard[] = [];
const EMPTY_ENTITIES: PostEntity[] = [];
const EMPTY_ETAPAS: Map<number, WorkflowEtapa[]> = new Map();

export function useMinhaFilaData({ enabled }: UseMinhaFilaDataOptions): MinhaFilaData {
  const common = { enabled, staleTime: STALE_MS } as const;
  const wf = useQuery({ queryKey: ['workflows'], queryFn: getWorkflows, ...common });
  const etapas = useQuery({ queryKey: ['all-active-etapas'], queryFn: fetchEtapasMap, ...common });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes, ...common });
  const membros = useQuery({ queryKey: ['membros'], queryFn: getMembros, ...common });
  // Sem refetchInterval: o poll de publicação é do useActivePosts de Entregas.
  const posts = useQuery({ queryKey: ['active-posts'], queryFn: getActivePosts, ...common });
  const vigentes = useQuery({
    queryKey: ['post-processes', 'vigentes'],
    queryFn: getVigentePostProcesses,
    ...common,
  });

  const workflows = wf.data ?? EMPTY_WORKFLOWS;
  const etapasMap = etapas.data ?? EMPTY_ETAPAS;
  const clientesList = clientes.data ?? EMPTY_CLIENTES;
  const membrosList = membros.data ?? EMPTY_MEMBROS;
  const processes = vigentes.data ?? EMPTY_PROCESSES;

  const activeWorkflows = useMemo(
    () => (workflows.length ? workflows.filter((w) => w.status === 'ativo') : EMPTY_WORKFLOWS),
    [workflows],
  );
  const cards = useMemo(
    () =>
      activeWorkflows.length
        ? buildBoardCards(activeWorkflows, etapasMap, clientesList, membrosList)
        : EMPTY_CARDS,
    [activeWorkflows, etapasMap, clientesList, membrosList],
  );
  const postEntities = useMemo(() => {
    if (processes.length === 0) return EMPTY_ENTITIES;
    const out: PostEntity[] = [];
    for (const p of processes) {
      if (p.estado !== 'ativo') continue;
      const e = toPostEntity(p, { clientes: clientesList, membros: membrosList });
      if (e) out.push(e);
    }
    return out;
  }, [processes, clientesList, membrosList]);

  const all = [wf, etapas, clientes, membros, posts, vigentes];
  return {
    cards,
    posts: posts.data ?? EMPTY_POSTS,
    postEntities,
    isLoading: enabled && all.some((q) => q.isPending),
    isError: all.some((q) => q.isLoadingError),
  };
}
