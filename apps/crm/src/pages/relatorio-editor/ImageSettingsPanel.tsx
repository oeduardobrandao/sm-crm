// Corpo do popover "Ajustes da imagem" (spec 2026-10-02; mockup artboard 3).
// Tudo vai por onConfigChange (desfazer/refazer); a largura vai por
// onSizeChange (block.size não é config).
import type { ReactNode } from 'react';
import { RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { IMAGE_ALT_MAX, IMAGE_CAPTION_MAX } from '@mesaas/report-blocks/types';
import type { BlockSize, ImageRatio, ReportBlock } from '@mesaas/report-blocks/types';
import { orientationOf, readImageConfig } from '@mesaas/report-blocks/image';

const H_RATIOS: ImageRatio[] = ['original', '16:9', '3:2', '4:3', '1:1'];
const V_RATIOS: ImageRatio[] = ['original', '4:5', '3:4', '2:3', '9:16'];
const FOCAL_LABELS = [
  'Topo à esquerda',
  'Topo',
  'Topo à direita',
  'Esquerda',
  'Centro',
  'Direita',
  'Base à esquerda',
  'Base',
  'Base à direita',
];

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
  const cfg = readImageConfig(block.config);
  const orientation = orientationOf(cfg);
  const ratios = orientation === 'vertical' ? V_RATIOS : H_RATIOS;
  const patch = (p: Record<string, unknown>) => onConfigChange(block.id, p);
  const isOriginal = cfg.ratio === 'original';

  return (
    <div className="rb-img-panel">
      <p className="rb-img-label">Orientação</p>
      <Seg
        label="Orientação"
        value={orientation}
        options={[
          {
            value: 'horizontal',
            label: 'Horizontal',
            icon: <RectangleHorizontal className="h-4 w-4" aria-hidden />,
          },
          {
            value: 'vertical',
            label: 'Vertical',
            icon: <RectangleVertical className="h-4 w-4" aria-hidden />,
          },
        ]}
        onPick={(o) => patch({ ratio: o === 'vertical' ? '4:5' : '16:9' })}
      />

      <p className="rb-img-label">Proporção</p>
      <div role="radiogroup" aria-label="Proporção" className="rb-img-chips">
        {ratios.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={cfg.ratio === r}
            className={`rb-img-chip${cfg.ratio === r ? ' is-on' : ''}`}
            onClick={() => cfg.ratio !== r && patch({ ratio: r })}
          >
            {r === 'original' ? 'Original' : r}
          </button>
        ))}
      </div>
      {isOriginal && (
        <p className="rb-img-help">
          {mode === 'template'
            ? 'Usa o formato da imagem que for enviada em cada relatório.'
            : 'Mostra a imagem inteira, no formato em que foi enviada.'}
        </p>
      )}

      {!isOriginal && (
        <>
          <p className="rb-img-label">Quando não couber</p>
          <Seg
            label="Quando não couber"
            value={cfg.fit}
            options={[
              { value: 'cover', label: 'Preencher' },
              { value: 'contain', label: 'Mostrar inteira' },
            ]}
            onPick={(fit) => patch({ fit })}
          />
          <p className="rb-img-help">
            {cfg.fit === 'cover'
              ? 'Corta as bordas para preencher o formato.'
              : 'Mostra tudo, com faixas nas sobras.'}
          </p>
        </>
      )}

      {!isOriginal && cfg.fit === 'cover' && (
        <>
          <p className="rb-img-label">Enquadramento</p>
          <div role="radiogroup" aria-label="Enquadramento" className="rb-img-focal">
            {FOCAL_LABELS.map((label, i) => {
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
          <p className="rb-img-help">
            Escolhe qual parte da imagem fica visível quando ela é cortada.
          </p>
        </>
      )}

      {orientation === 'vertical' && block.size === 'full' && (
        <div className="rb-img-hint">
          Em largura total, imagens verticais ficam com até 560 px de altura, centralizadas.{' '}
          <button type="button" className="rb-img-link" onClick={() => onSizeChange('half')}>
            Usar meia largura
          </button>
        </div>
      )}

      {mode === 'report' && (
        <>
          <Label htmlFor={`img-caption-${block.id}`} className="rb-img-label">
            Legenda (opcional)
          </Label>
          <Input
            id={`img-caption-${block.id}`}
            value={cfg.caption}
            maxLength={IMAGE_CAPTION_MAX}
            placeholder="Escreva uma legenda"
            onChange={(e) => patch({ caption: e.target.value || undefined })}
          />
          <Label htmlFor={`img-alt-${block.id}`} className="rb-img-label">
            Descrição da imagem
          </Label>
          <Input
            id={`img-alt-${block.id}`}
            value={cfg.alt}
            maxLength={IMAGE_ALT_MAX}
            onChange={(e) => patch({ alt: e.target.value || undefined })}
          />
          <p className="rb-img-help">Lida por leitores de tela. Não aparece no relatório.</p>
        </>
      )}

      {onReplace && (
        <div className="rb-img-footer">
          <Button size="sm" variant="outline" onClick={onReplace}>
            Trocar imagem
          </Button>
        </div>
      )}
    </div>
  );
}
