import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, MailX } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Same shape the function accepts: `<b64url payload>.<b64url signature>`. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

type State = 'idle' | 'submitting' | 'done' | 'invalid' | 'error';

/**
 * Only picks the copy (client digest vs. Agenda guest). Not a security check:
 * the function verifies the HMAC on POST, and a forged payload just gets 404.
 */
export function isGuestToken(token: string): boolean {
  try {
    const b64 = token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(b64)) as { g?: unknown } | null;
    return !!parsed && typeof parsed === 'object' && parsed.g !== undefined;
  } catch {
    return false;
  }
}

/**
 * Página pública de descadastro dos e-mails que a agência manda para clientes
 * (resumo de pendências do Hub) e para convidados da Agenda. O rodapé desses
 * e-mails aponta para cá porque o gateway do Supabase entrega o HTML das
 * functions como text/plain: a página da própria `client-email-unsub` aparece
 * como código. Abrir esta página não grava nada (scanners de link abrem URLs
 * de e-mail); só o clique no botão manda o POST, o mesmo do One-Click.
 */
export default function CancelarAvisosPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { t } = useTranslation('settings');
  const [state, setState] = useState<State>(TOKEN_SHAPE.test(token) ? 'idle' : 'invalid');
  const [guest] = useState(() => isGuestToken(token));

  async function handleConfirm() {
    setState('submitting');
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-email-unsub/${encodeURIComponent(token)}`,
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
        <h1 className="mb-2 text-xl font-semibold">{t('clientUnsub.doneTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('clientUnsub.doneBody')}</p>
      </>,
    );
  }

  if (state === 'invalid') {
    return shell(
      <>
        <CircleAlert className="mx-auto mb-4 h-10 w-10 text-[var(--warning)]" />
        <h1 className="mb-2 text-xl font-semibold">{t('clientUnsub.invalidTitle')}</h1>
        <p className="text-sm text-muted-foreground">{t('clientUnsub.invalidBody')}</p>
      </>,
    );
  }

  return shell(
    <>
      <MailX className="mx-auto mb-4 h-10 w-10 text-muted-foreground" />
      <h1 className="mb-3 text-xl font-semibold">{t('clientUnsub.title')}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {t(guest ? 'clientUnsub.bodyGuest' : 'clientUnsub.bodyClient')}
      </p>
      {state === 'error' && (
        <p className="mb-4 text-sm text-[var(--danger-text)]" role="alert">
          {t('clientUnsub.error')}
        </p>
      )}
      <Button className="w-full" onClick={handleConfirm} disabled={state === 'submitting'}>
        {state === 'submitting' ? t('clientUnsub.submitting') : t('clientUnsub.cta')}
      </Button>
    </>,
  );
}
