// Prévia do "Padrão do sistema": o layout embutido renderizado como o cliente
// o vê (BlockRenderer em modo view), com dados de exemplo e a marca real do
// workspace. Só leitura; "Duplicar para editar" cria um modelo editável.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import {
  buildSystemDefaultLayout,
  createReportTemplate,
  SYSTEM_TEMPLATE_NAME,
} from '../../services/reportTemplates';
import { useSampleSnapshot } from './useSampleSnapshot';

const SETTINGS_PATH = '/configuracao/relatorios';
const AI_TYPES = new Set(['ai_summary', 'ai_recommendations', 'ai_goals']);
const AI_SAMPLE_TEXT = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Texto gerado pela IA em cada relatório.' }],
    },
  ],
};

// Blocos de IA não guardam texto no modelo e o TextBlock renderiza null sem
// texto: na prévia eles ganham um parágrafo de exemplo para não sumirem.
function withAiSampleText(layout: ReportLayout): ReportLayout {
  return {
    ...layout,
    blocks: layout.blocks.map((b) => (AI_TYPES.has(b.type) ? { ...b, text: AI_SAMPLE_TEXT } : b)),
  };
}

export default function ModeloPadraoPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const snapshot = useSampleSnapshot();
  const layout = useMemo(() => buildSystemDefaultLayout(), []);
  const previewLayout = useMemo(() => withAiSampleText(layout), [layout]);

  const duplicate = useMutation({
    mutationFn: () => createReportTemplate(`${SYSTEM_TEMPLATE_NAME} (cópia)`, layout),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: ['report-templates'] });
      navigate(`/relatorios/modelos/${row.id}`);
    },
    onError: () => toast.error('Não foi possível criar o modelo.'),
  });

  return (
    <div>
      <header
        style={{
          maxWidth: 880,
          margin: '0 auto 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <Button variant="outline" size="sm" asChild>
          <Link to={SETTINGS_PATH}>
            <ArrowLeft className="h-3.5 w-3.5" /> Modelos
          </Link>
        </Button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <h1
            style={{
              margin: 0,
              fontSize: '1.35rem',
              fontWeight: 700,
              letterSpacing: '-1px',
              color: 'var(--text-main)',
            }}
          >
            {SYSTEM_TEMPLATE_NAME}
          </h1>
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Modelo embutido. Somente visualização.
          </p>
        </div>
        <Button size="sm" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
          <Copy className="h-3.5 w-3.5" /> Duplicar para editar
        </Button>
      </header>

      <p
        role="note"
        style={{
          maxWidth: 880,
          margin: '0 auto 1.25rem',
          padding: '0.6rem 0.85rem',
          borderRadius: 10,
          background: 'var(--surface-2)',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
        Dados de exemplo. Os números reais entram quando o relatório é gerado.
      </p>

      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <BlockRenderer layout={previewLayout} snapshot={snapshot} mode="view" />
      </div>
    </div>
  );
}
