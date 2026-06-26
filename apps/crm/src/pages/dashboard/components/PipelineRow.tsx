import { useTranslation } from 'react-i18next';

interface PipelineRowProps {
  pipeline: { agendados: number; em_producao: number; agente: number; falha: number };
}

export function PipelineRow({ pipeline }: PipelineRowProps) {
  const { t } = useTranslation('dashboard');
  const { agendados, em_producao, agente, falha } = pipeline;
  const parts: string[] = [];

  if (agendados + em_producao === 0) {
    parts.push(t('health.pipeline.parado'));
  } else {
    if (agendados > 0) parts.push(t('health.pipeline.agendados', { count: agendados }));
    if (em_producao > 0) parts.push(t('health.pipeline.em_producao', { count: em_producao }));
  }
  if (agente > 0) parts.push('🤖 ' + t('health.pipeline.agente', { count: agente }));
  if (falha > 0) parts.push('⚠ ' + t('health.pipeline.falha', { count: falha }));

  return (
    <div
      style={{
        fontSize: '0.72rem',
        color: 'var(--text-muted)',
        background: 'var(--surface-hover)',
        borderRadius: 8,
        padding: '5px 9px',
        marginTop: 8,
      }}
    >
      {parts.join(' · ')}
    </div>
  );
}
