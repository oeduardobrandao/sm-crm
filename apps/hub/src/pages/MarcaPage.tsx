import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { Download } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchBrand } from '../api';
import { sanitizeExternalUrl } from '../lib/security';

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-xl hub-border hub-bg-card border">
      <div
        className="w-12 h-12 rounded-lg border hub-border shadow-inner"
        style={{ backgroundColor: color }}
      />
      <div>
        <p className="text-[13.5px] font-semibold hub-txt">{label}</p>
        <p className="text-[11.5px] hub-tx3 mt-0.5">{color}</p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="text-[13px] font-semibold hub-tx2 mb-3">{children}</h3>;
}

export function MarcaPage() {
  const { t } = useTranslation('hubBrand');
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-brand', token],
    queryFn: () => fetchBrand(token),
  });

  const { brand, files } = data ?? { brand: null, files: [] };
  const isEmpty = !brand && files.length === 0;

  return (
    <div className="max-w-5xl mx-auto space-y-10 hub-fade-up">
      <PageHeader
        title={t('title', 'Marca')}
        description={t('description', 'Cores, logos e tipografia do seu negócio.')}
      />

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" />
        </div>
      ) : isEmpty ? (
        <p className="hub-tx2 text-sm">
          {t('empty', 'Nenhum material de marca foi adicionado ainda.')}
        </p>
      ) : (
        <>
          {brand?.logo_url && (
            <section>
              <SectionLabel>{t('sections.logo', 'Logo')}</SectionLabel>
              <div className="hub-card p-10 flex items-center justify-center">
                <img
                  src={brand.logo_url}
                  alt={t('logoAlt', 'Logo')}
                  className="max-h-28 max-w-full object-contain"
                />
              </div>
            </section>
          )}

          {(brand?.primary_color || brand?.secondary_color) && (
            <section>
              <SectionLabel>{t('sections.colors', 'Cores')}</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {brand.primary_color && (
                  <ColorSwatch
                    color={brand.primary_color}
                    label={t('colors.primary', 'Cor primária')}
                  />
                )}
                {brand.secondary_color && (
                  <ColorSwatch
                    color={brand.secondary_color}
                    label={t('colors.secondary', 'Cor secundária')}
                  />
                )}
              </div>
            </section>
          )}

          {(brand?.font_primary || brand?.font_secondary) && (
            <section>
              <SectionLabel>{t('sections.typography', 'Tipografia')}</SectionLabel>
              <div className="hub-card hub-divide">
                {brand.font_primary && (
                  <div className="flex justify-between items-center px-5 py-4 text-sm">
                    <span className="hub-tx3">{t('fonts.primary', 'Fonte principal')}</span>
                    <span className="font-semibold hub-txt">{brand.font_primary}</span>
                  </div>
                )}
                {brand.font_secondary && (
                  <div className="flex justify-between items-center px-5 py-4 text-sm">
                    <span className="hub-tx3">{t('fonts.secondary', 'Fonte secundária')}</span>
                    <span className="font-semibold hub-txt">{brand.font_secondary}</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {files.length > 0 && (
            <section>
              <SectionLabel>{t('sections.files', 'Arquivos')}</SectionLabel>
              <div className="space-y-2">
                {files.map((f) => (
                  <a
                    key={f.id}
                    href={sanitizeExternalUrl(f.file_url)}
                    download
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hub-card hub-card-hover hub-download-link flex items-center justify-between px-5 py-4 group"
                  >
                    <span className="text-[14px] font-semibold hub-txt">{f.name}</span>
                    <span className="hub-download-hint flex items-center gap-2 text-[12px] hub-tx3 transition-colors">
                      {t('download', 'Baixar')}
                      <Download size={15} />
                    </span>
                  </a>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
