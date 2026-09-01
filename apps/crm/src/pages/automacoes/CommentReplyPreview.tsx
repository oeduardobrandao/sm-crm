// Prévia da resposta pública automática, no estilo de um comentário do
// Instagram: comentário fictício do seguidor seguido da resposta da conta.
// Cores FIXAS do Instagram light de propósito, como em DmPreview.tsx.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from './DmPreview';

const IG = {
  surface: '#ffffff',
  text: '#111111',
  muted: '#8e8e8e',
  hairline: '#dbdbdb',
};

export default function CommentReplyPreview({
  clientName,
  clientSigla,
  clientCor,
  replies,
  keyword,
}: {
  clientName: string | null;
  clientSigla?: string | null;
  clientCor?: string | null;
  replies: string[];
  keyword?: string | null;
}) {
  const { t } = useTranslation('automations');
  const [activeIndex, setActiveIndex] = useState(0);
  const filled = replies.map((r) => r.trim()).filter((r) => r !== '');
  const index = Math.min(activeIndex, Math.max(filled.length - 1, 0));
  const activeReply = filled[index] ?? '';
  const trimmedKeyword = keyword?.trim();
  const sampleComment = trimmedKeyword
    ? t('form.commentPreviewSample', { keyword: trimmedKeyword })
    : t('form.commentPreviewSampleGeneric');

  return (
    <div>
      <p
        className="text-xs font-medium"
        style={{ color: 'var(--text-muted)', margin: '0 0 0.35rem' }}
      >
        {t('form.repliesPreviewTitle')}
      </p>
      <div
        className="rounded-2xl border"
        style={{ background: IG.surface, borderColor: IG.hairline, padding: '0.75rem' }}
      >
        {filled.length === 0 ? (
          <p style={{ color: IG.muted, fontSize: '0.78rem', margin: 0, textAlign: 'center' }}>
            {t('form.repliesPreviewEmpty')}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Avatar clientName={null} clientSigla={null} clientCor={null} size={24} />
              <div style={{ fontSize: '0.78rem', color: IG.text, lineHeight: 1.35, minWidth: 0 }}>
                <span style={{ fontWeight: 600, marginRight: 4 }}>
                  {t('form.commentPreviewAuthor')}
                </span>
                <span style={{ overflowWrap: 'anywhere' }}>{sampleComment}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginLeft: 32 }}>
              <Avatar
                clientName={clientName}
                clientSigla={clientSigla}
                clientCor={clientCor}
                size={22}
              />
              <div style={{ fontSize: '0.78rem', color: IG.text, lineHeight: 1.35, minWidth: 0 }}>
                <span style={{ fontWeight: 600, marginRight: 4 }}>
                  {clientName ?? t('form.previewAccount')}
                </span>
                <span style={{ overflowWrap: 'anywhere' }}>{activeReply}</span>
              </div>
            </div>
          </div>
        )}
        {filled.length > 1 && (
          <div style={{ display: 'flex', gap: 5, marginTop: 12, justifyContent: 'center' }}>
            {filled.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t('form.repliesPreviewVariation', { index: i + 1 })}
                aria-pressed={i === index}
                onClick={() => setActiveIndex(i)}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  background: i === index ? 'var(--primary-color)' : IG.hairline,
                }}
              />
            ))}
          </div>
        )}
      </div>
      {filled.length > 1 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
          {t('form.repliesPreviewNote')}
        </p>
      )}
    </div>
  );
}
