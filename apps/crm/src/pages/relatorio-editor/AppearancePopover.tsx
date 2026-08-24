// Popover "Aparência": tema, dupla de fontes e cor de destaque num lugar só
// (decisão do visual companion 2026-08-24: popover, não drawer). Toda mudança
// flui por onChange -> applyLayout -> autosave; preview é imediato porque os
// tokens são CSS vars no canvas (Task 5).
import { Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { FONT_PAIRINGS } from '@mesaas/report-blocks/theme';
import type {
  ReportDocSnapshot,
  ReportFontId,
  ReportLayout,
  ReportThemeId,
} from '@mesaas/report-blocks/types';
import { REPORT_FONT_IDS } from '@mesaas/report-blocks/types';
import { setLayoutAccent, setLayoutFonts, setLayoutTheme } from './layoutOps';

const THEME_OPTIONS: { id: ReportThemeId | undefined; label: string; hint: string }[] = [
  { id: undefined, label: 'Padrão', hint: 'segue a página' },
  { id: 'clean', label: 'Clean', hint: 'claro e neutro' },
  { id: 'editorial', label: 'Editorial', hint: 'creme, serifa' },
  { id: 'bold', label: 'Bold', hint: 'marca em tudo' },
];

export interface AppearancePopoverProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  onChange: (next: ReportLayout) => void;
}

export function AppearancePopover({ layout, snapshot, onChange }: AppearancePopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Palette className="h-3.5 w-3.5" /> Aparência
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="rb-appearance">
        <p className="rb-appearance-label">Tema</p>
        <div className="rb-appearance-themes" role="radiogroup" aria-label="Tema do relatório">
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              role="radio"
              aria-checked={layout.theme === opt.id}
              className={`rb-appearance-theme${layout.theme === opt.id ? ' rb-appearance-selected' : ''}`}
              onClick={() => onChange(setLayoutTheme(layout, opt.id))}
            >
              <span className={`rb-appearance-thumb rb-appearance-thumb-${opt.id ?? 'default'}`} />
              <span>
                {opt.label}
                <small>{opt.hint}</small>
              </span>
            </button>
          ))}
        </div>
        <p className="rb-appearance-label">Fontes</p>
        <div role="radiogroup" aria-label="Fontes do relatório">
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
              {FONT_PAIRINGS[id].label}
            </button>
          ))}
        </div>
        <p className="rb-appearance-label">Cor de destaque</p>
        <div className="rb-appearance-accent">
          <ColorPicker
            value={layout.accent ?? snapshot.branding.accent_color}
            onChange={(hex) => onChange(setLayoutAccent(layout, hex))}
            brandColors={[snapshot.branding.accent_color]}
            allowAlpha={false}
            label="Cor de destaque"
          />
          {layout.accent && (
            <button
              type="button"
              className="rb-appearance-reset"
              onClick={() => onChange(setLayoutAccent(layout, undefined))}
            >
              usar cor da marca
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
