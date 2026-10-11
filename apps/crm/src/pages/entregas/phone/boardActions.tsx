import { createContext, useContext } from 'react';
import type { ActivePost, Membro } from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import type { WorkflowCardCounts } from './PhoneBoardCards';

/**
 * Everything a phone row or card needs to act on a fluxo or a post individual,
 * provided once by EntregasPage (phones only) so the Lista, the posts list and
 * Minha fila wire the same handlers the desktop board uses. Stage moves go
 * through one page-level `useWorkflowStageCommands` / `usePostProcessCommands`
 * instance (same confirmations, same RPCs).
 */
export interface PhoneBoardActions {
  membros: Membro[];
  onRefresh: () => void;
  countsFor: (workflowId: number) => WorkflowCardCounts;
  workflow: {
    open: (card: BoardCard) => void;
    edit: (card: BoardCard) => void;
    forward: (card: BoardCard) => void;
    revert: (card: BoardCard) => void;
    duplicate?: (card: BoardCard) => void;
    remove?: (card: BoardCard) => void;
  };
  post: {
    open: (entity: PostEntity) => void;
    /** Avançar etapa, or Concluir processo on the last step (canConcluir). */
    forward: (entity: PostEntity) => void;
    revert: (entity: PostEntity) => void;
    removeProcess: (entity: PostEntity) => void;
    duplicate?: (entity: PostEntity) => void;
    remove?: (entity: PostEntity) => void;
  };
  /** Opens a post of any kind (avulso slot or its fluxo's drawer). */
  openPost: (post: ActivePost) => void;
  /** Board card of a post's fluxo (unfiltered), and the process of an avulso. */
  cardOfPost: (post: ActivePost) => BoardCard | undefined;
  entityOfPost: (post: ActivePost) => PostEntity | undefined;
}

export const PhoneBoardActionsContext = createContext<PhoneBoardActions | null>(null);

/** Null outside the phone layout (and in unit tests that don't provide it). */
export function usePhoneBoardActions(): PhoneBoardActions | null {
  return useContext(PhoneBoardActionsContext);
}
