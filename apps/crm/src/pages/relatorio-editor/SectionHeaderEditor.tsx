// Edição inline do cabeçalho de seção no canvas: título e subtítulo viram
// inputs com a MESMA tipografia do bloco renderizado (SectionHeaderBlock), com
// a barra de accent espelhada. O config flui pelo autosave como qualquer
// edição de layout.
import { useTranslation } from 'react-i18next';
import type { ReportBlock } from '@mesaas/report-blocks/types';

export interface SectionHeaderEditorProps {
  block: ReportBlock;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
}

export function SectionHeaderEditor({ block, onConfigChange }: SectionHeaderEditorProps) {
  const { t } = useTranslation('reportEditor');
  const title = typeof block.config?.title === 'string' ? block.config.title : '';
  const subtitle = typeof block.config?.subtitle === 'string' ? block.config.subtitle : '';
  return (
    <div style={{ marginTop: '1rem' }}>
      <input
        aria-label={t('sectionHeader.titleAria')}
        value={title}
        placeholder={t('sectionHeader.titlePlaceholder')}
        onChange={(e) => onConfigChange(block.id, { title: e.target.value })}
        className="rb-section-input"
        style={{
          fontSize: '1.15rem',
          fontWeight: 700,
          fontFamily: 'var(--rb-font-display, inherit)',
          color: 'var(--rb-section-title, inherit)',
          letterSpacing: '-1px',
        }}
      />
      <input
        aria-label={t('sectionHeader.subtitleAria')}
        value={subtitle}
        placeholder={t('sectionHeader.subtitlePlaceholder')}
        onChange={(e) => onConfigChange(block.id, { subtitle: e.target.value })}
        className="rb-section-input"
        style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '0.15rem' }}
      />
      <div
        style={{
          width: 48,
          height: 3,
          background: 'var(--rb-accent-line, var(--rb-accent))',
          borderRadius: 2,
          marginTop: '0.4rem',
        }}
      />
    </div>
  );
}
