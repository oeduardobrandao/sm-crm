import { useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { AuthContext } from '@/context/AuthContext';
import { useWorkspaceLimits } from './useWorkspaceLimits';

/** Assinatura unica de INSERT em equipe_mensagens. RLS restringe a entrega
 * as conversas do usuario; o guard de conta_id abaixo e defesa extra contra
 * bleed multi-workspace (mesmo racional do canal wm: do AuthContext).
 * Polling de 60s nas queries segue como fallback: nao ha handler de
 * status/reconexao (padrao do repo). */
export function useEquipeChatRealtime(activeConversaId: number | null): void {
  const qc = useQueryClient();
  const auth = useContext(AuthContext);
  const userId = auth?.user?.id ?? null;
  const workspaceId = auth?.profile?.conta_id ?? null;
  // An unlimited workspace never gets a `features` payload (see
  // useWorkspaceLimits), so it's carved out explicitly -- otherwise it'd
  // read as off despite MensagensPage already rendering team chat for it.
  const { features, isUnlimited } = useWorkspaceLimits();
  const enabled = isUnlimited || features?.feature_team_chat === true;

  useEffect(() => {
    if (!enabled || !userId || !workspaceId) return;
    const channel = supabase
      .channel(`equipe-chat:${userId}:${workspaceId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'equipe_mensagens' },
        (payload) => {
          const row = payload.new as { conversa_id?: number; conta_id?: string };
          if (row.conta_id !== workspaceId) return;
          if (activeConversaId != null && row.conversa_id === activeConversaId) {
            qc.invalidateQueries({ queryKey: ['equipe-mensagens', activeConversaId] });
            qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
          } else {
            qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
            qc.invalidateQueries({ queryKey: ['equipe-chat-unread'] });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, workspaceId, activeConversaId, qc]);
}
