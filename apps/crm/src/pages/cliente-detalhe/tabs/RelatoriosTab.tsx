import { useOutletContext, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { updateCliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

/**
 * "Relatórios" tab: the monthly-report preference toggles, ported from the
 * pre-split ClienteDetalhePage (see git history at d30adeea), plus a shortcut
 * to Analytics (the plan's new addition for this tab — distinct from the
 * "Ver Analytics Completo" button already inside InstagramSection on the
 * Redes sociais tab, which only shows once an Instagram account has synced;
 * this one is always available from Relatórios).
 *
 * All copy lives in clients.json (namespace 'clients') — the historical card
 * had every string hardcoded in Portuguese, which the plan's i18n constraint
 * requires fixing as part of this extraction.
 *
 * Role gating: the layout (ClienteDetalhePage.tsx / clienteTabs.model.ts)
 * already redirects anyone without STAFF access away from
 * /clientes/:id/relatorios at the route level, so this tab never re-checks
 * role itself — it only ever mounts for an authorized user.
 *
 * Query isolation: this tab fires no queries of its own — `updateCliente` is
 * a plain mutation, and the only cache interaction is invalidating
 * `['cliente', clienteId]` (owned by the layout) after a successful toggle.
 */
export default function RelatoriosTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation('clients');

  const handleToggle = async (
    field: 'send_report_email' | 'include_ai_analysis',
    checked: boolean,
    onI18nKey: string,
    offI18nKey: string,
  ) => {
    try {
      await updateCliente(clienteId, { [field]: checked });
      queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
      toast.success(t(checked ? onI18nKey : offI18nKey));
    } catch {
      toast.error(t('detail.reportPrefUpdateError'));
    }
  };

  return (
    <div id="sec-relatorio" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <h3 className="text-xl font-bold tracking-tight text-foreground mb-1">
        {t('detail.monthlyReportTitle')}
      </h3>
      <p className="text-sm text-muted-foreground mb-4">{t('detail.monthlyReportDesc')}</p>

      {/* Toggle: Send report email */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
              {t('detail.sendReportEmailTitle')}
            </div>
            <div style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {t('detail.sendReportEmailDesc')}
            </div>
          </div>
          <Switch
            aria-label={t('detail.sendReportEmailTitle')}
            checked={cliente.send_report_email ?? false}
            onCheckedChange={(checked) =>
              handleToggle(
                'send_report_email',
                checked,
                'detail.sendReportEmailOn',
                'detail.sendReportEmailOff',
              )
            }
          />
        </div>
      </div>

      {/* Toggle: Include AI analysis */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ color: 'var(--text-main)', fontSize: '0.85rem', fontWeight: 500 }}>
              {t('detail.includeAiAnalysisTitle')}
            </div>
            <div style={{ color: 'var(--text-light)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
              {t('detail.includeAiAnalysisDesc')}
            </div>
          </div>
          <Switch
            aria-label={t('detail.includeAiAnalysisTitle')}
            checked={cliente.include_ai_analysis ?? true}
            onCheckedChange={(checked) =>
              handleToggle(
                'include_ai_analysis',
                checked,
                'detail.includeAiAnalysisOn',
                'detail.includeAiAnalysisOff',
              )
            }
          />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Button onClick={() => navigate(`/analytics/${clienteId}`)}>
          {t('detail.viewFullAnalytics')}
        </Button>
      </div>
    </div>
  );
}
