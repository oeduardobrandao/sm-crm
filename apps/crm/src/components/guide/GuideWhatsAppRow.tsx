import { useQuery } from '@tanstack/react-query';
import { Check, ExternalLink, MessageCircle } from 'lucide-react';
import { getEffectivePlanWithSource } from '../../services/billing';
import { isWhatsAppSupportEnabled } from '../../lib/whatsapp';
import { WhatsAppSupportButton } from '../support/WhatsAppSupportButton';
import { buttonVariants } from '../ui/button';

/** Texto escuro sobre o verde de --success: passa o AA (4.5:1) com folga nos dois temas. */
const CTA_STYLE = { background: 'var(--success)', color: '#062b1b', textDecoration: 'none' };

/**
 * Convite para falar com o time no WhatsApp, no topo da tela inicial do guia.
 * Não é uma trilha: não conta no "x de y páginas" nem bloqueia a conclusão.
 *
 * Só para workspace em BRL, como o /comecar: WhatsApp é canal do Brasil (spec
 * de cobrança em USD, §7). Some enquanto a moeda carrega, para um workspace USD
 * nunca ver a linha piscar; erro conta como BRL, o mesmo padrão do /comecar.
 */
export function GuideWhatsAppRow({
  openedAt,
  onOpen,
  compact,
}: {
  openedAt?: string;
  onOpen(): void;
  /** Phone sheet: a short button label, so the title keeps its line. */
  compact?: boolean;
}) {
  const enabled = isWhatsAppSupportEnabled();
  // Mesma chave do TrialNudgeCard e do /comecar: no dashboard já está em cache.
  const { data, isLoading } = useQuery({
    queryKey: ['billing', 'effective-plan-with-source'],
    queryFn: getEffectivePlanWithSource,
    enabled,
  });
  if (!enabled || isLoading || data?.billingCurrency === 'usd') return null;

  const opened = Boolean(openedAt);
  return (
    <div
      data-testid="guide-whatsapp"
      style={{
        border: '1px solid var(--success)',
        background: 'rgba(62, 207, 142, 0.1)',
        borderRadius: 12,
        padding: '13px 15px',
        display: 'flex',
        gap: 13,
        alignItems: 'center',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 10,
          background: 'var(--success)',
          color: '#fff',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: 'none',
        }}
      >
        <MessageCircle className="h-5 w-5" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: '0.86rem', fontWeight: 600 }}>
          Fale com a gente no WhatsApp
        </p>
        <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          {opened ? (
            <>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  color: 'var(--text-main)',
                  fontWeight: 500,
                }}
              >
                <Check className="h-3 w-3" aria-hidden="true" style={{ color: 'var(--success)' }} />
                Conversa aberta.
              </span>{' '}
              Se não enviou, é só abrir de novo.
            </>
          ) : (
            'Uma pessoa do time ajuda a configurar sua conta, sem robô no meio.'
          )}
        </p>
      </div>
      <WhatsAppSupportButton
        context="guide"
        onOpen={onOpen}
        className={buttonVariants({ variant: opened ? 'outline' : 'default', size: 'sm' })}
        data-slot="button"
        data-variant={opened ? 'outline' : 'default'}
        data-size="sm"
        style={opened ? { textDecoration: 'none' } : CTA_STYLE}
        label={
          opened ? (
            'Abrir de novo'
          ) : (
            <>
              {compact ? 'Abrir' : 'Abrir WhatsApp'}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </>
          )
        }
      />
    </div>
  );
}
