import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

const TRANSACTIONAL_IDS = ['invite', 'billing', 'instagram'] as const;

/** The 3 transactional rows: always sent, no user control, listed here only
 * for transparency. Content is fixed by the Task 8 brief. Resolved at call time so
 * the copy follows the UI language. */
export function transactionalRows(): { label: string; when: string; recipients: string }[] {
  return TRANSACTIONAL_IDS.map((id) => ({
    label: i18n.t(`settings:notifications.transactional.${id}.label`),
    when: i18n.t(`settings:notifications.transactional.${id}.when`),
    recipients: i18n.t(`settings:notifications.transactional.${id}.recipients`),
  }));
}

/** Label of the one opt-in e-mail (marketing). */
export function marketingLabel(): string {
  return i18n.t('settings:notifications.marketingLabel');
}

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
      toast.error(i18n.t('settings:notifications.saveError'));
    },
  });

  return { marketingOptIn, saveMarketing: saveMarketing.mutate };
}
