import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Same shape the function accepts: `<b64url payload>.<b64url signature>`. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type State = 'idle' | 'submitting' | 'done' | 'invalid' | 'error';

/**
 * Página pública de descadastro das dicas por e-mail (nurture). O rodapé do
 * e-mail aponta para cá porque o gateway do Supabase entrega o HTML das
 * functions como text/plain: a página da própria `nurture-unsub` aparece como
 * código. Abrir esta página não grava nada (scanners de link abrem URLs de
 * e-mail); só o clique no botão manda o POST, o mesmo do One-Click do Gmail.
 */
export default function DescadastrarPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t } = useTranslation('settings');
  const [state, setState] = useState<State>(TOKEN_SHAPE.test(token) ? 'idle' : 'invalid');

  async function handleConfirm() {
    setState('submitting');
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/nurture-unsub/${encodeURIComponent(token)}`,
        { method: 'POST' },
      );
      if (res.ok) setState('done');
      else if (res.status === 404) setState('invalid');
      else setState('error');
    } catch {
      setState('error');
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );

  if (state === 'done') {
    return shell(
      <>
        <CircleCheck className="mx-auto mb-4 h-10 w-10 text-[var(--success)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('nurtureUnsub.doneTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('nurtureUnsub.doneBody')}</p>
      </>,
    );
  }

  if (state === 'invalid') {
    return shell(
      <>
        <CircleAlert className="mx-auto mb-4 h-10 w-10 text-[var(--warning)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('nurtureUnsub.invalidTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('nurtureUnsub.invalidBody')}</p>
      </>,
    );
  }

  return shell(
    <>
      <MailX className="mx-auto mb-4 h-10 w-10 text-[var(--primary-color)]" />
      <h1 className="mb-3 text-xl font-semibold">{t('nurtureUnsub.title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">{t('nurtureUnsub.body')}</p>
      {state === 'error' && (
        <p className="mb-4 text-sm text-[var(--danger-text)]" role="alert">
          {t('nurtureUnsub.error')}
        </p>
      )}
      <Button className="w-full" onClick={handleConfirm} disabled={state === 'submitting'}>
        {state === 'submitting' ? t('nurtureUnsub.submitting') : t('nurtureUnsub.cta')}
      </Button>
    </>,
  );
}
