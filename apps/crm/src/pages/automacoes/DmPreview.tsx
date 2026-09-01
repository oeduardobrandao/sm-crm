// Prévia ao vivo da DM, replicando o chat do Instagram (estilo ManyChat):
// cabeçalho da conversa, bolha cinza de mensagem recebida, botões do button
// template como bolhas empilhadas e a barra "Responder..." ao pé. Cores FIXAS
// do Instagram light de propósito (é um mockup do app, não uma superfície do
// CRM), então o painel fica idêntico nos temas claro e escuro do CRM.
// Monograma: sigla/cor do cadastro do cliente; hash do nome só como fallback.
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { DmButton } from '@/store';
import { avatarColorClass } from '@/lib/avatarColor';
import { getInitials } from '@/store';
import { sanitizeExternalUrl } from '@/utils/security';

const IG = {
  surface: '#ffffff',
  bubble: '#efefef',
  text: '#111111',
  muted: '#8e8e8e',
  hairline: '#dbdbdb',
};

function Avatar({
  clientName,
  clientSigla,
  clientCor,
  size,
}: {
  clientName: string | null;
  clientSigla?: string | null;
  clientCor?: string | null;
  size: number;
}) {
  return (
    <div
      className={`avatar ${clientCor ? '' : avatarColorClass(clientName)}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        flexShrink: 0,
        ...(clientCor ? { background: clientCor } : {}),
      }}
    >
      {clientSigla?.trim() || (clientName ? getInitials(clientName) : '?')}
    </div>
  );
}

export default function DmPreview({
  clientName,
  clientSigla,
  clientCor,
  text,
  buttons,
  mediaUrl,
  subtitle,
}: {
  clientName: string | null;
  clientSigla?: string | null;
  clientCor?: string | null;
  text: string;
  buttons: DmButton[];
  /** Preview de leitura (blob: local ou URL assinada) da mídia do cartão.
   * Ausente/vazio -> bolha de texto de sempre, sem cartão. */
  mediaUrl?: string | null;
  /** Subtítulo do cartão. Só faz sentido junto de `mediaUrl`. */
  subtitle?: string | null;
}) {
  const { t } = useTranslation('automations');
  const trimmedText = text.trim();
  const trimmedSubtitle = (subtitle ?? '').trim();
  const visibleButtons = buttons.filter((b) => b.title.trim() !== '');
  const hasMedia = !!mediaUrl;
  const empty = !trimmedText && visibleButtons.length === 0 && !hasMedia;
  const bubbleBase: CSSProperties = {
    background: IG.bubble,
    borderRadius: 18,
    maxWidth: '85%',
    fontSize: '0.8rem',
    lineHeight: 1.35,
    color: IG.text,
  };
  const buttonEls = visibleButtons.map((b, i) => (
    <a
      key={i}
      href={sanitizeExternalUrl(b.url)}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        ...bubbleBase,
        display: 'block',
        padding: '0.55rem 0.7rem',
        textAlign: 'center',
        fontWeight: 600,
        textDecoration: 'none',
        maxWidth: '85%',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {b.title.trim()}
    </a>
  ));

  return (
    <div>
      <p
        className="text-xs font-medium"
        style={{ color: 'var(--text-muted)', margin: '0 0 0.35rem' }}
      >
        {t('form.previewTitle')}
      </p>
      <div
        className="rounded-2xl border"
        style={{ background: IG.surface, borderColor: IG.hairline, overflow: 'hidden' }}
      >
        {/* Cabeçalho da conversa */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.55rem 0.75rem',
            borderBottom: `1px solid ${IG.hairline}`,
          }}
        >
          <Avatar
            clientName={clientName}
            clientSigla={clientSigla}
            clientCor={clientCor}
            size={28}
          />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: IG.text,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {clientName ?? t('form.previewAccount')}
            </div>
            <div style={{ fontSize: '0.65rem', color: IG.muted }}>Instagram</div>
          </div>
        </div>

        {/* Área do chat */}
        <div
          style={{
            padding: '0.75rem',
            minHeight: 200,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 6,
          }}
        >
          <div
            style={{
              textAlign: 'center',
              fontSize: '0.62rem',
              color: IG.muted,
              marginBottom: 4,
            }}
          >
            {t('form.previewNow')}
          </div>
          {empty ? (
            <p style={{ color: IG.muted, fontSize: '0.78rem', margin: 0, textAlign: 'center' }}>
              {t('form.previewEmpty')}
            </p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
              <Avatar
                clientName={clientName}
                clientSigla={clientSigla}
                clientCor={clientCor}
                size={22}
              />
              <div
                data-testid="dm-preview-bubble"
                style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}
              >
                {hasMedia ? (
                  <div
                    data-testid="dm-preview-card"
                    style={{
                      ...bubbleBase,
                      padding: 0,
                      overflow: 'hidden',
                      borderBottomLeftRadius: visibleButtons.length > 0 ? 18 : 4,
                    }}
                  >
                    <img
                      src={mediaUrl ?? undefined}
                      alt=""
                      style={{ width: '100%', borderRadius: '12px 12px 0 0', display: 'block' }}
                    />
                    {(trimmedText || trimmedSubtitle) && (
                      <div style={{ padding: '0.5rem 0.7rem' }}>
                        {trimmedText && (
                          <p
                            style={{
                              margin: 0,
                              fontWeight: 600,
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {trimmedText}
                          </p>
                        )}
                        {trimmedSubtitle && (
                          <p
                            style={{
                              margin: '0.15rem 0 0',
                              fontSize: '0.72rem',
                              color: IG.muted,
                              whiteSpace: 'pre-wrap',
                              overflowWrap: 'anywhere',
                            }}
                          >
                            {trimmedSubtitle}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  trimmedText && (
                    <p
                      style={{
                        ...bubbleBase,
                        margin: 0,
                        padding: '0.5rem 0.7rem',
                        whiteSpace: 'pre-wrap',
                        overflowWrap: 'anywhere',
                        borderBottomLeftRadius: visibleButtons.length > 0 ? 18 : 4,
                      }}
                    >
                      {trimmedText}
                    </p>
                  )
                )}
                {buttonEls}
                {hasMedia && (
                  <p
                    className="text-xs"
                    style={{ color: 'var(--text-muted)', margin: '0.15rem 0 0' }}
                  >
                    {t('form.previewCardFallbackNote')}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Barra de resposta */}
        <div style={{ padding: '0 0.75rem 0.75rem' }}>
          <div
            style={{
              border: `1px solid ${IG.hairline}`,
              borderRadius: 999,
              padding: '0.45rem 0.85rem',
              fontSize: '0.75rem',
              color: IG.muted,
            }}
          >
            {t('form.previewComposer')}
          </div>
        </div>
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
        {t('form.previewDesktopNote')}
      </p>
    </div>
  );
}
