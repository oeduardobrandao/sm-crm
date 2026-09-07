import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

const SAVE_ERROR_MESSAGE = 'Não foi possível salvar. Tente novamente.';

/** The 3 transactional rows: always sent, no user control, listed here only
 * for transparency. Content is fixed by the Task 8 brief. */
const TRANSACTIONAL_ROWS = [
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

const MARKETING_LABEL = 'Novidades e dicas do Mesaas';

/** "E-mails automáticos": transparency list of the account's transactional
 * emails (always on, no switch) plus the one email that IS opt-in, marketing,
 * wired to the same `profiles.marketing_opt_in` field as PerfilTab. */
export default function EmailsAutomaticosSection() {
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

  return (
    <div className="card animate-up">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">E-mails automáticos</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          E-mails que a sua conta envia sozinha, para transparência. Os 3 primeiros são sempre
          enviados; só o último depende de você.
        </p>
      </div>

      <div className="divide-y divide-[color:var(--border-color)]">
        {TRANSACTIONAL_ROWS.map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_96px] items-center gap-2 py-3">
            <div>
              <div className="font-medium">{row.label}</div>
              <div className="text-sm text-[color:var(--text-muted)]">Quando: {row.when}</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                Quem recebe: {row.recipients}
              </div>
            </div>
            <span className="text-center text-sm text-[color:var(--text-muted)]">sempre</span>
          </div>
        ))}

        <div className="grid grid-cols-[1fr_96px] items-center gap-2 py-3">
          <div>
            <div className="font-medium">{MARKETING_LABEL}</div>
            <div className="text-sm text-[color:var(--text-muted)]">
              Quando: marketing ocasional
            </div>
            <div className="text-sm text-[color:var(--text-muted)]">Quem recebe: você (opt-in)</div>
            <div className="text-sm text-[color:var(--text-muted)]">
              Mesmo controle que está no seu Perfil.
            </div>
          </div>
          <span className="flex justify-center">
            <Switch
              aria-label={MARKETING_LABEL}
              checked={marketingOptIn}
              onCheckedChange={(v) => saveMarketing.mutate(v)}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
