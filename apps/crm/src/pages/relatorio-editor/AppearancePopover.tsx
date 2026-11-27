// Popover "Aparência": dupla de fontes e cor de destaque num lugar só
// (decisão do visual companion 2026-08-24: popover, não drawer). Toda mudança
// flui por onChange -> applyLayout -> autosave; preview é imediato porque os
// tokens são CSS vars no canvas (Task 5).
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { FONT_PAIRINGS } from '@mesaas/report-blocks/theme';
import type { ReportDocSnapshot, ReportFontId, ReportLayout } from '@mesaas/report-blocks/types';
import { REPORT_FONT_IDS } from '@mesaas/report-blocks/types';
import { setLayoutAccent, setLayoutFonts } from './layoutOps';

export interface AppearancePopoverProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  /** coalesceKey: um arraste do seletor de cor inteiro vira um passo só no desfazer. */
  onChange: (next: ReportLayout, coalesceKey?: string) => void;
}

export function AppearancePopover({ layout, snapshot, onChange }: AppearancePopoverProps) {
  const { t } = useTranslation('reportEditor');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Palette className="h-3.5 w-3.5" /> {t('appearance.button')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="rb-appearance">
        <p className="rb-appearance-label">{t('appearance.fonts')}</p>
        <div role="radiogroup" aria-label={t('appearance.fontsAria')}>
          {REPORT_FONT_IDS.map((id: ReportFontId) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={layout.fonts === id}
              className={`rb-appearance-font${layout.fonts === id ? ' rb-appearance-selected' : ''}`}
              onClick={() => onChange(setLayoutFonts(layout, layout.fonts === id ? undefined : id))}
            >
              <span
                className="rb-appearance-ag"
                style={{ fontFamily: FONT_PAIRINGS[id].display }}
                aria-hidden
              >
                Ag
              </span>
              {id === 'system' ? t('appearance.fontSystem') : FONT_PAIRINGS[id].label}
            </button>
          ))}
        </div>
        <p className="rb-appearance-label">{t('appearance.accent')}</p>
        <div className="rb-appearance-accent">
          <ColorPicker
            value={layout.accent ?? snapshot.branding.accent_color}
            onChange={(hex, opts) => onChange(setLayoutAccent(layout, hex), opts?.coalesceKey)}
            brandColors={[snapshot.branding.accent_color]}
            allowAlpha={false}
            label={t('appearance.accent')}
          />
          {layout.accent && (
            <button
              type="button"
              className="rb-appearance-reset"
              onClick={() => onChange(setLayoutAccent(layout, undefined))}
            >
              {t('appearance.resetAccent')}
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
