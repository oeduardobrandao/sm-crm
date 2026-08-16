import { useOutletContext } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Cake } from 'lucide-react';
import { sanitizeUrl } from '@/utils/security';
import { ClienteDatasSection } from '../components/ClienteDatasSection';
import { ClienteEnderecosSection } from '../components/ClienteEnderecosSection';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

/**
 * "Visão geral" tab: cadastral info card ported verbatim from the pre-split
 * ClienteDetalhePage (see git history at d30adeea), plus the important-dates
 * and addresses sections. `clienteId`/`cliente` come from the layout via
 * `<Outlet context>` — this tab never fetches the cliente row itself.
 */
export default function VisaoGeralTab() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const { t } = useTranslation('clients');
  const { t: tc } = useTranslation();

  return (
    <>
      <div id="sec-info" className="card animate-up" style={{ marginBottom: '1.5rem' }}>
        <h3 className="text-xl font-bold tracking-tight mb-4 text-foreground">
          {t('detail.information')}
        </h3>
        <div className="client-info-grid">
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.email')}</span>
            <span className="client-info-value">{cliente.email || '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.phone')}</span>
            <span className="client-info-value">{cliente.telefone || '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.paymentDay')}</span>
            <span className="client-info-value">
              {cliente.data_pagamento ? t('detail.dayN', { day: cliente.data_pagamento }) : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.deliveryDay')}</span>
            <span className="client-info-value">
              {cliente.dia_entrega ? t('detail.dayN', { day: cliente.dia_entrega }) : '—'}
            </span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.specialty')}</span>
            <span className="client-info-value">{cliente.especialidade || '—'}</span>
          </div>
          <div className="client-info-item">
            <span className="client-info-label">{t('detail.birthday')}</span>
            <span
              className="client-info-value"
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {cliente.data_aniversario
                ? (() => {
                    const [mm, dd] = cliente.data_aniversario.split('-');
                    return (
                      <>
                        <Cake className="h-4 w-4" style={{ color: 'var(--pink, #f542c8)' }} />
                        {t('detail.dayOf', {
                          day: parseInt(dd),
                          month: tc(`months.${parseInt(mm) - 1}`),
                        })}
                      </>
                    );
                  })()
                : '—'}
            </span>
          </div>
          {cliente.notion_page_url && (
            <div className="client-info-item">
              <span className="client-info-label">Notion</span>
              <span className="client-info-value">
                <a
                  href={sanitizeUrl(cliente.notion_page_url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('openNotion')}
                </a>
              </span>
            </div>
          )}
        </div>
      </div>

      <ClienteDatasSection clienteId={clienteId} />
      <ClienteEnderecosSection clienteId={clienteId} />
    </>
  );
}
