import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  getNotificationEmailPrefs,
  setNotificationEmailPref,
  EMAIL_NOTIFICATION_TYPES,
  MASTER_PAUSE_TYPE,
  type NotificationEmailType,
} from '../../../store';

export default function NotificacoesTab() {
  const qc = useQueryClient();
  const { data: prefs, isLoading } = useQuery({
    queryKey: ['notification-email-prefs'],
    queryFn: getNotificationEmailPrefs,
  });

  const mutation = useMutation({
    mutationFn: (v: { type: NotificationEmailType | typeof MASTER_PAUSE_TYPE; enabled: boolean }) =>
      setNotificationEmailPref(v.type, v.enabled),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ['notification-email-prefs'] });
      const prev = qc.getQueryData<Record<string, boolean>>(['notification-email-prefs']);
      qc.setQueryData<Record<string, boolean>>(['notification-email-prefs'], (old) => ({
        ...(old ?? {}),
        [v.type]: v.enabled,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(['notification-email-prefs'], ctx.prev);
      toast.error('Não foi possível salvar a preferência.');
    },
    onSuccess: () => toast.success('Preferência salva.'),
  });

  if (isLoading)
    return (
      <div className="flex justify-center p-8">
        <Spinner />
      </div>
    );

  const isEnabled = (type: string) => prefs?.[type] !== false; // absent = default on
  const paused = prefs?.[MASTER_PAUSE_TYPE] === false;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Notificações por e-mail</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          Escolha quais eventos você quer receber por e-mail. Você continua vendo tudo no sino do
          app.
        </p>
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <span>
          <span className="block font-medium">Pausar todos os e-mails</span>
          <span className="block text-sm text-[color:var(--text-muted)]">
            Nenhum e-mail de notificação será enviado enquanto ativo.
          </span>
        </span>
        <Switch
          aria-label="Pausar todos os e-mails"
          checked={paused}
          onCheckedChange={(v) => mutation.mutate({ type: MASTER_PAUSE_TYPE, enabled: !v })}
        />
      </label>

      <div className="space-y-2">
        {EMAIL_NOTIFICATION_TYPES.map((t) => (
          <label
            key={t.type}
            className={`flex items-center justify-between gap-4 rounded-lg border p-4 ${paused ? 'opacity-50' : ''}`}
          >
            <span>
              <span className="block font-medium">{t.label}</span>
              <span className="block text-sm text-[color:var(--text-muted)]">{t.description}</span>
            </span>
            <Switch
              aria-label={t.label}
              disabled={paused}
              checked={isEnabled(t.type)}
              onCheckedChange={(v) => mutation.mutate({ type: t.type, enabled: v })}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
