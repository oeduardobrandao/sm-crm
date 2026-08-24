// Edição inline do cabeçalho de seção no canvas: título e subtítulo viram
// inputs com a MESMA tipografia do bloco renderizado (SectionHeaderBlock), com
// a barra de accent espelhada. O config flui pelo autosave como qualquer
// edição de layout.
import type { ReportBlock } from '@mesaas/report-blocks/types';

export interface SectionHeaderEditorProps {
  block: ReportBlock;
  onConfigChange: (id: string, patch: Record<string, unknown>) => void;
}

export function SectionHeaderEditor({ block, onConfigChange }: SectionHeaderEditorProps) {
  const title = typeof block.config?.title === 'string' ? block.config.title : '';
  const subtitle = typeof block.config?.subtitle === 'string' ? block.config.subtitle : '';
  return (
    <div style={{ marginTop: '1rem' }}>
      <input
        aria-label="Título da seção"
        value={title}
        placeholder="Título da seção"
        onChange={(e) => onConfigChange(block.id, { title: e.target.value })}
        className="rb-section-input"
        style={{
          fontSize: '1.15rem',
          fontWeight: 700,
          fontFamily: 'var(--rb-font-display, inherit)',
          color: 'var(--rb-section-title, inherit)',
        }}
      />
      <input
        aria-label="Subtítulo da seção"
        value={subtitle}
        placeholder="Subtítulo (opcional)"
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
