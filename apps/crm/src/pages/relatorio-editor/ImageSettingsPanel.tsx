// Corpo do popover "Ajustes da imagem" (spec 2026-10-02; mockup artboard 3).
// Tudo vai por onConfigChange (desfazer/refazer); a largura vai por
// onSizeChange (block.size não é config).
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IMAGE_ALT_MAX, IMAGE_CAPTION_MAX } from '@mesaas/report-blocks/types';
import type { BlockSize, ImageRatio, ReportBlock } from '@mesaas/report-blocks/types';
import { orientationOf, readImageConfig } from '@mesaas/report-blocks/image';

const H_RATIOS: ImageRatio[] = ['original', '16:9', '3:2', '4:3', '1:1'];
const V_RATIOS: ImageRatio[] = ['original', '4:5', '3:4', '2:3', '9:16'];
const FOCAL_KEYS = [
  'topLeft',
  'top',
  'topRight',
  'left',
  'center',
  'right',
  'bottomLeft',
  'bottom',
  'bottomRight',
] as const;

export interface ImageSettingsPanelProps {
  block: ReportBlock;
  mode: 'report' | 'template';
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
  onSizeChange: (size: BlockSize) => void;
  onReplace?: () => void; // "Trocar imagem"; ausente no modo template
}

function Seg<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onPick: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="rb-img-seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`rb-img-seg-btn${value === o.value ? ' is-on' : ''}`}
          onClick={() => value !== o.value && onPick(o.value)}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ImageSettingsPanel({
  block,
  mode,
  onConfigChange,
  onSizeChange,
  onReplace,
}: ImageSettingsPanelProps) {
  const { t } = useTranslation('reportEditor');
  const cfg = readImageConfig(block.config);
  const orientation = orientationOf(cfg);
  const ratios = orientation === 'vertical' ? V_RATIOS : H_RATIOS;
  const patch = (p: Record<string, unknown>) => onConfigChange(block.id, p);
  const isOriginal = cfg.ratio === 'original';

  return (
    <div className="rb-img-panel">
      <p className="rb-img-label">{t('imageSettings.orientation')}</p>
      <Seg
        label={t('imageSettings.orientation')}
        value={orientation}
        options={[
          {
            value: 'horizontal',
            label: t('imageSettings.horizontal'),
            icon: <RectangleHorizontal className="h-4 w-4" aria-hidden />,
          },
          {
            value: 'vertical',
            label: t('imageSettings.vertical'),
            icon: <RectangleVertical className="h-4 w-4" aria-hidden />,
          },
        ]}
        onPick={(o) => patch({ ratio: o === 'vertical' ? '4:5' : '16:9' })}
      />

      <p className="rb-img-label">{t('imageSettings.ratio')}</p>
      <div role="radiogroup" aria-label={t('imageSettings.ratio')} className="rb-img-chips">
        {ratios.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={cfg.ratio === r}
            className={`rb-img-chip${cfg.ratio === r ? ' is-on' : ''}`}
            onClick={() => cfg.ratio !== r && patch({ ratio: r })}
          >
            {r === 'original' ? t('imageSettings.original') : r}
          </button>
        ))}
      </div>
      {isOriginal && (
        <p className="rb-img-help">
          {mode === 'template'
            ? t('imageSettings.originalHintTemplate')
            : t('imageSettings.originalHintReport')}
        </p>
      )}

      {!isOriginal && (
        <>
          <p className="rb-img-label">{t('imageSettings.fit')}</p>
          <Seg
            label={t('imageSettings.fit')}
            value={cfg.fit}
            options={[
              { value: 'cover', label: t('imageSettings.fitCover') },
              { value: 'contain', label: t('imageSettings.fitContain') },
            ]}
            onPick={(fit) => patch({ fit })}
          />
          <p className="rb-img-help">
            {cfg.fit === 'cover'
              ? t('imageSettings.fitCoverHint')
              : t('imageSettings.fitContainHint')}
          </p>
        </>
      )}

      {!isOriginal && cfg.fit === 'cover' && (
        <>
          <p className="rb-img-label">{t('imageSettings.framing')}</p>
          <div role="radiogroup" aria-label={t('imageSettings.framing')} className="rb-img-focal">
            {FOCAL_KEYS.map((focalKey, i) => {
              const label = t(`imageSettings.focal.${focalKey}`);
              const x = (i % 3) / 2;
              const y = Math.floor(i / 3) / 2;
              const on = cfg.focal.x === x && cfg.focal.y === y;
              return (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={label}
                  className={`rb-img-focal-dot${on ? ' is-on' : ''}`}
                  onClick={() => !on && patch({ focal: { x, y } })}
                />
              );
            })}
          </div>
          <p className="rb-img-help">{t('imageSettings.framingHint')}</p>
        </>
      )}

      {orientation === 'vertical' && block.size === 'full' && (
        <div className="rb-img-hint">
          {t('imageSettings.verticalFullHint')}{' '}
          <button type="button" className="rb-img-link" onClick={() => onSizeChange('half')}>
            {t('imageSettings.useHalfWidth')}
          </button>
        </div>
      )}

      {mode === 'report' && (
        <>
          <Label htmlFor={`img-caption-${block.id}`} className="rb-img-label">
            {t('imageSettings.caption')}
          </Label>
          <Input
            id={`img-caption-${block.id}`}
            value={cfg.caption}
            maxLength={IMAGE_CAPTION_MAX}
            placeholder={t('imageSettings.captionPlaceholder')}
            onChange={(e) => patch({ caption: e.target.value || undefined })}
          />
          <Label htmlFor={`img-alt-${block.id}`} className="rb-img-label">
            {t('imageSettings.alt')}
          </Label>
          <Input
            id={`img-alt-${block.id}`}
            value={cfg.alt}
            maxLength={IMAGE_ALT_MAX}
            onChange={(e) => patch({ alt: e.target.value || undefined })}
          />
          <p className="rb-img-help">{t('imageSettings.altHint')}</p>
        </>
      )}

      {onReplace && (
        <div className="rb-img-footer">
          <Button size="sm" variant="outline" onClick={onReplace}>
            {t('image.replace')}
          </Button>
        </div>
      )}
    </div>
  );
}
