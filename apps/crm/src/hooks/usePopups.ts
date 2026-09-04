import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getActivePopups,
  getMyPopupInteractions,
  recordPopupInteraction,
  type PopupAction,
  type PopupInteraction,
} from '../store/popups';

export const POPUPS_KEY = ['popups'] as const;
export const POPUP_INTERACTIONS_KEY = ['popup-interactions'] as const;

/** Duas queries + gravação otimista e silenciosa. A decisão de mostrar fica no
 * GlobalPopupHost; a escolha pura em pickPopup. */
export function usePopups() {
  const queryClient = useQueryClient();

  const popupsQuery = useQuery({
    queryKey: POPUPS_KEY,
    queryFn: getActivePopups,
    staleTime: 5 * 60_000,
  });

  const interactionsQuery = useQuery({
    queryKey: POPUP_INTERACTIONS_KEY,
    queryFn: getMyPopupInteractions,
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: ({ popupId, action }: { popupId: string; action: PopupAction }) =>
      recordPopupInteraction(popupId, action),
    onMutate: async ({ popupId, action }) => {
      await queryClient.cancelQueries({ queryKey: POPUP_INTERACTIONS_KEY });
      queryClient.setQueryData<PopupInteraction[]>(POPUP_INTERACTIONS_KEY, (old) => [
        ...(old || []),
        { popup_id: popupId, action },
      ]);
    },
    onError: (err) => {
      // O popup já sumiu da sessão; no pior caso volta na próxima. Sem toast.
      console.warn('[popups] failed to record interaction', err);
    },
  });

  const record = useCallback(
    (popupId: string, action: PopupAction) => mutation.mutate({ popupId, action }),
    [mutation.mutate],
  );

  return {
    popupsQuery,
    interactionsQuery,
    record,
  };
}
