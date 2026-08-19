// Preview ao vivo da DM (balão simulado do Instagram) no editor de automação.
// Puramente apresentacional: monograma do cliente (registro do CRM, não a
// conta IG -- é um preview, não uma simulação), texto e botões empilhados
// como o button template renderiza no app.
import { useTranslation } from 'react-i18next';
import type { DmButton } from '@/store';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/store';
import { sanitizeExternalUrl } from '@/utils/security';

export default function DmPreview({
  clientName,
  clientSeed,
  text,
  buttons,
}: {
  clientName: string | null;
  clientSeed: string | number | null;
  text: string;
  buttons: DmButton[];
}) {
  const { t } = useTranslation('automations');
  const trimmedText = text.trim();
  const visibleButtons = buttons.filter((b) => b.title.trim() !== '');
  const empty = !trimmedText && visibleButtons.length === 0;

  return (
    <div>
      <p
        className="text-xs font-medium"
        style={{ color: 'var(--text-muted)', margin: '0 0 0.35rem' }}
      >
        {t('form.previewTitle')}
      </p>
      <div
        className="rounded-lg border"
        style={{ background: 'var(--surface-hover, var(--surface-1))', padding: '0.75rem' }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}
        >
          <div
            className={`avatar ${avatarColorClass(clientSeed ?? clientName)}`}
            style={{ width: 24, height: 24, fontSize: '0.65rem', flexShrink: 0 }}
          >
            {clientName ? getInitials(clientName) : '?'}
          </div>
          <span className="text-xs font-medium">{clientName ?? t('form.previewAccount')}</span>
        </div>
        {empty ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
            {t('form.previewEmpty')}
          </p>
        ) : (
          <div
            className="rounded-lg border bg-card"
            style={{ maxWidth: '85%', overflow: 'hidden' }}
            data-testid="dm-preview-bubble"
          >
            {trimmedText && (
              <p
                className="text-sm"
                style={{
                  margin: 0,
                  padding: '0.6rem 0.75rem',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                }}
              >
                {trimmedText}
              </p>
            )}
            {visibleButtons.map((b, i) => (
              <a
                key={i}
                href={sanitizeExternalUrl(b.url)}
                target="_blank"
                rel="noopener noreferrer"
                className="block border-t text-center text-sm font-medium text-primary"
                style={{ padding: '0.55rem 0.75rem', textDecoration: 'none' }}
              >
                {b.title.trim()}
              </a>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
        {t('form.previewDesktopNote')}
      </p>
    </div>
  );
}
