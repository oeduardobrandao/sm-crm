import { useId, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { WorkflowPost } from '@/store';
import { TIPO_COLORS, TIPO_LABELS, TIPO_ORDER } from '../postLabels';
import { TIPO_ICONS } from '../tipoIcons';
import { IconTip } from './IconTip';

type Tipo = WorkflowPost['tipo'];

/**
 * Campo "Tipo" do editor de post: um botão por formato, só ícone, com o nome no
 * tooltip. Escolha única e obrigatória (clicar no ativo não desmarca).
 */
export function TipoToggle({
  value,
  lockedReason,
  onChange,
}: {
  value: Tipo;
  /** Agendado: o formato não muda. */
  lockedReason: string | null;
  onChange: (tipo: Tipo) => void;
}) {
  const { t } = useTranslation('postEditor');
  const labelId = useId();
  return (
    <div className="drawer-post-field drawer-post-field--tipo">
      <label id={labelId}>{t('tipoToggle.label')}</label>
      <TooltipProvider delayDuration={200}>
        <ToggleGroup.Root
          type="single"
          className="icon-seg"
          aria-labelledby={labelId}
          value={value}
          disabled={lockedReason !== null}
          onValueChange={(v) => {
            if (v) onChange(v as Tipo);
          }}
        >
          {TIPO_ORDER.map((tipo) => {
            const Icon = TIPO_ICONS[tipo];
            return (
              <IconTip key={tipo} label={TIPO_LABELS[tipo]} reason={lockedReason}>
                <ToggleGroup.Item
                  value={tipo}
                  aria-label={TIPO_LABELS[tipo]}
                  className="icon-seg__item"
                  style={{ '--tipo-color': TIPO_COLORS[tipo] } as CSSProperties}
                >
                  <Icon size={16} aria-hidden="true" />
                </ToggleGroup.Item>
              </IconTip>
            );
          })}
        </ToggleGroup.Root>
      </TooltipProvider>
    </div>
  );
}
