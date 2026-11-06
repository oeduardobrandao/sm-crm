import { useMemo } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useCurrentMembro } from '../../hooks/useCurrentMembro';
import { useMinhaFilaData } from '../entregas/hooks/useMinhaFilaData';
import { buildMinhaFila, EMPTY_FILA, type FilaItem } from '../entregas/minhaFila';
import type { DeadlineInfo } from '../entregas/etapaPrazo';

export const MINHA_FILA_MAX_ROWS = 3;

export type MinhaFilaTeaserState = 'error' | 'loading' | 'no-membro' | 'empty' | 'ready';

export function prazoClass(deadline: DeadlineInfo): string {
  if (deadline.estourado) return 'deadline-overdue';
  if (deadline.urgente) return 'deadline-warning';
  return 'deadline-ok';
}

/** Mesmo deep link de todayAgenda.postHref, mais `view=fila` para cair na
 *  fila (consumeParams em EntregasPage só remove drawer/post). */
export function minhaFilaItemHref(item: FilaItem): string {
  const p = item.post;
  return p.workflow_id != null
    ? `/entregas?view=fila&drawer=${p.workflow_id}&post=${p.id}`
    : `/entregas?view=fila&post=${p.id}`;
}

/**
 * Dados do teaser "Minha fila" (desktop e celular): a fila de Entregas do membro
 * vinculado e o estado a mostrar. Queries component-local.
 */
export function useMinhaFilaTeaser() {
  const { workspaceRole, membershipResolved } = useAuth();
  // Só decide com o papel do workspace já resolvido: `workspaceRole` cai para
  // `null` até a consulta de membership terminar, e um agente ainda não
  // vinculado não pode ver o link para /equipe por um instante com base no
  // fallback do `role` do profile (achado do review: falso-positivo de acesso).
  const canManageTeam =
    membershipResolved === true && (workspaceRole === 'owner' || workspaceRole === 'admin');
  const { membro, isPending: membroPending, isError: membroError } = useCurrentMembro();
  const membroId = membro?.id ?? null;
  const data = useMinhaFilaData({ enabled: membroId != null });

  const fila = useMemo(
    () =>
      membroId != null
        ? buildMinhaFila(
            { cards: data.cards, posts: data.posts, postEntities: data.postEntities },
            membroId,
            new Date(),
          )
        : EMPTY_FILA,
    [membroId, data.cards, data.posts, data.postEntities],
  );

  let state: MinhaFilaTeaserState;
  if (membroError || (membroId != null && data.isError)) {
    // `data.isError` is gated by `membroId != null`, same as `data.isLoading`
    // below (fix round 2): the six queries are `enabled: membroId != null`, but
    // they read a SHARED cache keyed by e.g. ['active-posts'] -- a disabled
    // observer still reflects an error left over on that key from an earlier
    // load (Entregas, or a previous linked session). Without this gate, an
    // unlinked user would see "couldn't load" instead of "vincule seu usuário".
    // `membroError` is NOT gated: without the membros list we can't tell if the
    // user is linked at all, so it always wins.
    //
    // Checked before loading: a failed query with no cached data must win over a
    // sibling query that is merely paused (e.g. offline), or the card would spin
    // forever instead of surfacing the error (fix round 1, finding 2).
    state = 'error';
  } else if (membroPending || (membroId != null && data.isLoading)) {
    // `membroPending` (isPending: no data, no error yet), NOT the derived
    // `isLoading` (isPending && isFetching): a paused/offline cold start has
    // isLoading=false with no membro yet, which would otherwise fall through to
    // the no-membro branch below and wrongly show "vincule seu usuário" to a user
    // who IS linked (fix round 1, finding 1).
    state = 'loading';
  } else if (membroId == null) {
    state = 'no-membro';
  } else if (fila.items.length === 0) {
    state = 'empty';
  } else {
    state = 'ready';
  }

  return { canManageTeam, membroId, state, fila };
}
