// Prévia do "Padrão do sistema": o layout embutido renderizado como o cliente
// o vê (BlockRenderer em modo view), com dados de exemplo e a marca real do
// workspace. Só leitura; "Duplicar para editar" cria um modelo editável.
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Copy, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockRenderer } from '@mesaas/report-blocks/BlockRenderer';
import { sectionizeLayout } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { buildSystemDefaultLayout, createReportTemplate } from '../../services/reportTemplates';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useIsTabletShell } from '@/lib/phoneShell';
import { useSampleSnapshot } from './useSampleSnapshot';
import { withAiSampleText } from './templateOps';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { ReportPhoneView } from './phone/ReportPhoneView';
import { WorkspaceReportLang } from './WorkspaceReportLang';

const SETTINGS_PATH = '/configuracao/relatorios';
function ModeloPadraoPageContent() {
  const { t } = useTranslation('reportEditor');
  const systemName = t('template.systemName');
  // Tablet (shell do celular a partir de 768x600): a prévia de desktop dentro do shell.
  const isTablet = useIsTabletShell();
  const isPhone = !useIsDesktop(768) && !isTablet;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const snapshot = useSampleSnapshot();
  // Seccionado como nos editores: "Duplicar para editar" grava um layout
  // canônico (o embutido já sai assim; legado = convertido).
  const layout = useMemo(() => sectionizeLayout(buildSystemDefaultLayout()), []);
  const previewLayout = useMemo(() => withAiSampleText(layout), [layout]);

  const duplicate = useMutation({
    mutationFn: () =>
      createReportTemplate(
        // Same key as ReportTemplatesCard, so both entry points save the same copy name.
        t('settingsHub:templates.systemCopyName', { name: systemName }),
        layout,
      ),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: ['report-templates'] });
      navigate(`/relatorios/modelos/${row.id}`);
    },
    onError: () => toast.error(t('template.duplicateError')),
  });

  // Celular (D27): só a prévia; "Duplicar para editar" continua no "…".
  if (isPhone) {
    return (
      <ReportPhoneView
        title={systemName}
        subtitle={t('template.builtinSubtitle')}
        fallbackTo={SETTINGS_PATH}
        backLabel={t('template.backToTemplates')}
        sampleNote={t('template.sampleNote')}
        layout={previewLayout}
        snapshot={snapshot}
        actionsLabel={t('template.actionsLabel')}
        actions={[
          {
            label: t('template.duplicate'),
            disabled: duplicate.isPending,
            onSelect: () => duplicate.mutate(),
          },
        ]}
      />
    );
  }

  return (
    <div>
      {/* Tablet: the phone view's nav bar replaces the "Modelos" button (sticky, app.css). */}
      {isTablet && (
        <PhoneNavBar
          className="rb-editor-nav-bar"
          backLabel={t('template.backToTemplates')}
          fallbackTo={SETTINGS_PATH}
        />
      )}
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
        {!isTablet && (
          <Button variant="outline" size="sm" asChild>
            <Link to={SETTINGS_PATH}>
              <ArrowLeft className="h-3.5 w-3.5" /> {t('template.templatesButton')}
            </Link>
          </Button>
        )}
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
            {systemName}
          </h1>
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {t('template.builtinSubtitle')}
          </p>
        </div>
        <Button size="sm" disabled={duplicate.isPending} onClick={() => duplicate.mutate()}>
          <Copy className="h-3.5 w-3.5" /> {t('template.duplicate')}
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
        {t('template.sampleNote')}
      </p>

      <div style={{ maxWidth: 880, margin: '0 auto' }}>
        <BlockRenderer layout={previewLayout} snapshot={snapshot} mode="view" />
      </div>
    </div>
  );
}

/** Blocos no idioma do workspace, o mesmo do PDF e do Hub. */
export default function ModeloPadraoPage() {
  return (
    <WorkspaceReportLang>
      <ModeloPadraoPageContent />
    </WorkspaceReportLang>
  );
}
