import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

const SAVE_ERROR_MESSAGE = 'Não foi possível salvar. Tente novamente.';

/** The 3 transactional rows: always sent, no user control, listed here only
 * for transparency. Content is fixed by the Task 8 brief. */
export const TRANSACTIONAL_ROWS = [
  {
    label: 'Convite para a equipe',
    when: 'você convida alguém para o workspace',
    recipients: 'o convidado',
  },
  {
    label: 'Cobrança e pagamento',
    when: 'um pagamento falha (avisos de retry e cancelamento)',
    recipients: 'dono do workspace',
  },
  {
    label: 'Instagram conectado',
    when: 'o cliente conclui a conexão pelo link que você enviou',
    recipients: 'quem criou o link',
  },
];

export const MARKETING_LABEL = 'Novidades e dicas do Mesaas';

/**
 * The marketing opt-in of "E-mails automáticos", wired to the same
 * `profiles.marketing_opt_in` field as PerfilTab. Shared by the desktop section and
 * the phone sub-screen.
 */
export function useEmailsAutomaticos() {
  const { user, profile, refetchProfile } = useAuth();

  // Local mirror of profiles.marketing_opt_in, optimistically flipped on
  // toggle (mutation's onMutate/rollback below) and resynced whenever the
  // AuthContext profile changes underneath us (e.g. after refetchProfile()).
  const [marketingOptIn, setMarketingOptIn] = useState(profile?.marketing_opt_in === true);
  useEffect(() => {
    setMarketingOptIn(profile?.marketing_opt_in === true);
  }, [profile]);

  const saveMarketing = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('profiles')
        .update({ marketing_opt_in: enabled })
        .eq('id', user!.id);
      if (error) throw error;
      await refetchProfile();
    },
    onMutate: (enabled: boolean) => {
      // Optimistic flip so the switch responds instantly instead of waiting
      // on the round trip, same convention as SuasNotificacoesSection's
      // onMutate/rollback mutations.
      const prev = marketingOptIn;
      setMarketingOptIn(enabled);
      return { prev };
    },
    onError: (_err, _enabled, ctx) => {
      if (ctx) setMarketingOptIn(ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
  });

  return { marketingOptIn, saveMarketing: saveMarketing.mutate };
}
