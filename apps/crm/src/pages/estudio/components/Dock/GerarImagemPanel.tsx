// T6.4 GerarImagemPanel (design §8): the editor's AI-image panel. Prompt + AR chips (defaulting
// to the canvas AR) + placement (fundo→2K, camada→1K) + brand-logo toggle + a quota meter that
// counts with the server's reservation predicate (useAiImageQuota). On success the generated
// file becomes either a centered image layer ("Inserir como camada") or the page background
// ("Usar como fundo") — one undo step each — and its preview_url is seeded so it renders with
// no round-trip flash. Errors render INLINE (this is a popover; a toast would be easy to miss).
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Loader2 } from 'lucide-react';
import type { AspectRatio } from '@mesaas/design-doc';
import { useGenerateImage } from '../../hooks/useGenerateImage';
import { useAiImageQuota } from '../../hooks/useAiImageQuota';
import { ImageGenClientError, type GenerateImageResponse } from '../../services/imageGen';

const PROMPT_MAX = 2000;

// The GENERATOR's aspect ratios — a superset of the canvas ARs (adds 16:9 for landscape). The
// design canvas only allows 1:1/4:5/9:16, so a generated 16:9 image is used as a layer, not the
// canvas ratio; the request aspect_ratio is the generator's set, independent of the doc.
type GenAspectRatio = '1:1' | '4:5' | '9:16' | '16:9';
const ASPECT_RATIOS: GenAspectRatio[] = ['1:1', '4:5', '9:16', '16:9'];

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-main)',
  fontSize: '0.85rem',
  color: 'var(--text-main)',
  background: 'var(--surface-main)',
  border: '1px solid var(--border-color)',
  borderRadius: 8,
  padding: '0.5rem 0.6rem',
  width: '100%',
  resize: 'vertical',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

function chip(active: boolean): React.CSSProperties {
  return {
    padding: '0.3rem 0.6rem',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
    background: active ? 'var(--primary-color)' : 'var(--surface-main)',
    color: active ? '#12151a' : 'var(--text-main)',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
  };
}

export interface GerarImagemPanelProps {
  postId: number;
  clienteId: number | null;
  hasBrandLogo: boolean;
  /** The doc's current aspect ratio — the AR chips default here. */
  canvasAspectRatio: AspectRatio;
  /** Monthly plan cap (null = unlimited) for the quota meter. */
  monthlyLimit: number | null;
  /** Insert the generated file as a centered image layer (EstudioPage owns the dispatch). */
  onInsertLayer: (fileId: number, natural: { width: number; height: number }) => void;
  /** Set the generated file as the active page background (a background fills the canvas — no
   * intrinsic dimensions needed, unlike a layer). */
  onSetBackground: (fileId: number) => void;
}

/** Maps a §8 error code to inline PT copy. feature/quota get their own emphasis; the rest are
 * transient/actionable hints. */
function errorCopyKey(code: string): string {
  switch (code) {
    case 'feature_disabled':
      return 'aiPanel.error.featureDisabled';
    case 'quota_exhausted':
      return 'aiPanel.error.quotaExhausted';
    case 'rate_limited':
      return 'aiPanel.error.rateLimited';
    case 'generation_in_progress':
      return 'aiPanel.error.inProgress';
    case 'safety_refusal':
      return 'aiPanel.error.safety';
    case 'invalid_reference':
      return 'aiPanel.error.invalidReference';
    case 'storage_quota_exceeded':
      return 'aiPanel.error.storageQuota';
    case 'provider_timeout':
      return 'aiPanel.error.timeout';
    default:
      return 'aiPanel.error.generic';
  }
}

export function GerarImagemPanel({
  postId,
  clienteId,
  hasBrandLogo,
  canvasAspectRatio,
  monthlyLimit,
  onInsertLayer,
  onSetBackground,
}: GerarImagemPanelProps) {
  const { t } = useTranslation('estudio');
  const [prompt, setPrompt] = useState('');
  // Default to the canvas AR (a subset of the generator's set), user can pick any of the 4.
  const [aspectRatio, setAspectRatio] = useState<GenAspectRatio>(canvasAspectRatio);
  const [placement, setPlacement] = useState<'background' | 'element'>('element');
  const [useBrandLogo, setUseBrandLogo] = useState(false);
  const [result, setResult] = useState<GenerateImageResponse | null>(null);

  const mutation = useGenerateImage();
  const quota = useAiImageQuota(monthlyLimit, true);

  const atLimit = quota.data?.limit != null && quota.data.used >= quota.data.limit;

  // The idempotency key is STABLE across retries of one submission — minted lazily, kept until a
  // success (or a prompt edit), then cleared so the NEXT generation is a fresh submission. This
  // makes "Gerar" after a transient/lost-response failure replay the SAME generation server-side
  // instead of double-spending on a request that may have already succeeded.
  const idempotencyKeyRef = useRef<string | null>(null);

  const submit = () => {
    const trimmed = prompt.trim();
    if (!trimmed || mutation.isPending) return;
    setResult(null);
    if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
    mutation.mutate(
      {
        prompt: trimmed,
        aspect_ratio: aspectRatio,
        placement,
        client_id: clienteId ?? undefined,
        post_id: postId,
        use_brand_logo: useBrandLogo && hasBrandLogo,
        idempotency_key: idempotencyKeyRef.current,
      },
      {
        onSuccess: (res) => {
          setResult(res);
          idempotencyKeyRef.current = null; // next generation is a new submission
        },
      },
    );
  };

  // A prompt edit is a new intent — retire the current key so the edited prompt gets a fresh one
  // (the server's reuse path would otherwise regenerate the OLD row under the same key).
  const onPromptChange = (value: string) => {
    setPrompt(value);
    idempotencyKeyRef.current = null;
  };

  const errorMessage = (() => {
    if (!mutation.isError) return null;
    const e = mutation.error;
    const code = e instanceof ImageGenClientError ? e.code : 'unknown';
    return t(errorCopyKey(code));
  })();

  return (
    <div
      data-testid="estudio-ai-panel"
      style={{ width: 280, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <label style={labelStyle} htmlFor="ai-prompt">
          {t('aiPanel.promptLabel')}
        </label>
        <textarea
          id="ai-prompt"
          data-testid="estudio-ai-prompt"
          rows={3}
          maxLength={PROMPT_MAX}
          value={prompt}
          placeholder={t('aiPanel.promptPlaceholder')}
          onChange={(e) => onPromptChange(e.target.value)}
          style={inputStyle}
        />
        <span style={{ ...labelStyle, alignSelf: 'flex-end', fontWeight: 400 }}>
          {prompt.length}/{PROMPT_MAX}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <span style={labelStyle}>{t('aiPanel.aspectRatio')}</span>
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
          {ASPECT_RATIOS.map((ar) => (
            <button
              key={ar}
              type="button"
              style={chip(aspectRatio === ar)}
              onClick={() => setAspectRatio(ar)}
            >
              {ar}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <span style={labelStyle}>{t('aiPanel.placement')}</span>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <button
            type="button"
            style={chip(placement === 'element')}
            onClick={() => setPlacement('element')}
          >
            {t('aiPanel.placementElement')}
          </button>
          <button
            type="button"
            style={chip(placement === 'background')}
            onClick={() => setPlacement('background')}
          >
            {t('aiPanel.placementBackground')}
          </button>
        </div>
      </div>

      {hasBrandLogo && (
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={useBrandLogo}
            onChange={(e) => setUseBrandLogo(e.target.checked)}
          />
          <span style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
            {t('aiPanel.useBrandLogo')}
          </span>
        </label>
      )}

      {quota.data && (
        <div
          style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}
          data-testid="estudio-ai-quota"
        >
          {quota.data.limit == null
            ? t('aiPanel.quotaUnlimited', { used: quota.data.used })
            : t('aiPanel.quota', { used: quota.data.used, limit: quota.data.limit })}
        </div>
      )}

      <button
        type="button"
        data-testid="estudio-ai-generate"
        disabled={!prompt.trim() || mutation.isPending || atLimit}
        onClick={submit}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          padding: '0.55rem',
          borderRadius: 8,
          border: 'none',
          background: 'var(--primary-color)',
          color: '#12151a',
          fontWeight: 700,
          fontSize: '0.85rem',
          cursor: !prompt.trim() || mutation.isPending || atLimit ? 'default' : 'pointer',
          opacity: !prompt.trim() || mutation.isPending || atLimit ? 0.5 : 1,
        }}
      >
        {mutation.isPending ? (
          <Loader2 size={15} className="animate-spin" />
        ) : (
          <Sparkles size={15} />
        )}
        {mutation.isPending ? t('aiPanel.generating') : t('aiPanel.generate')}
      </button>

      {atLimit && !mutation.isError && (
        <p style={{ fontSize: '0.75rem', color: 'var(--danger)' }} data-testid="estudio-ai-atlimit">
          {t('aiPanel.error.quotaExhausted')}
        </p>
      )}

      {errorMessage && (
        <p style={{ fontSize: '0.75rem', color: 'var(--danger)' }} data-testid="estudio-ai-error">
          {errorMessage}
        </p>
      )}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <img
            src={result.preview_url}
            alt={t('aiPanel.resultAlt')}
            style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border-color)' }}
          />
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button
              type="button"
              data-testid="estudio-ai-insert-layer"
              style={{ ...chip(false), flex: 1, textAlign: 'center' }}
              onClick={() =>
                onInsertLayer(result.file_id, { width: result.width, height: result.height })
              }
            >
              {t('aiPanel.insertLayer')}
            </button>
            <button
              type="button"
              data-testid="estudio-ai-set-background"
              style={{ ...chip(false), flex: 1, textAlign: 'center' }}
              onClick={() => onSetBackground(result.file_id)}
            >
              {t('aiPanel.setBackground')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
