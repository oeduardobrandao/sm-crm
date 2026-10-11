import { Switch } from '@/components/ui/switch';
import { MARKETING_LABEL, TRANSACTIONAL_ROWS, useEmailsAutomaticos } from './useEmailsAutomaticos';

/** "E-mails automáticos": transparency list of the account's transactional
 * emails (always on, no switch) plus the one email that IS opt-in, marketing,
 * wired to the same `profiles.marketing_opt_in` field as PerfilTab. */
export default function EmailsAutomaticosSection() {
  const { marketingOptIn, saveMarketing } = useEmailsAutomaticos();

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
              onCheckedChange={(v) => saveMarketing(v)}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
