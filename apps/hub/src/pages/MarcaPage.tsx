import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchBrand } from '../api';

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-4 p-3 rounded-2xl border border-stone-200/80 bg-white">
      <div className="w-12 h-12 rounded-xl border border-stone-200/60 shadow-inner" style={{ backgroundColor: color }} />
      <div>
        <p className="text-[13.5px] font-semibold text-stone-900">{label}</p>
        <p className="text-[11px] text-stone-500 uppercase tracking-wider mt-0.5">{color}</p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold text-stone-500 uppercase tracking-[0.14em] mb-3 flex items-center">
      <span className="accent-bar" />{children}
    </h3>
  );
}

export function MarcaPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-brand', token],
    queryFn: () => fetchBrand(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-stone-300 border-t-stone-900" /></div>;

  const { brand, files } = data ?? { brand: null, files: [] };

  if (!brand && files.length === 0) {
    return (
      <div className="max-w-3xl mx-auto hub-fade-up">
        <h2 className="font-display text-[2rem] font-medium tracking-tight text-stone-900 mb-4">Marca</h2>
        <p className="text-stone-500 text-sm">Nenhum material de marca foi adicionado ainda.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-10 hub-fade-up">
      <header>
        <p className="text-[11px] uppercase tracking-[0.14em] text-stone-500 font-medium mb-2">
          <span className="accent-bar" />Identidade visual
        </p>
        <h2 className="font-display text-[2rem] sm:text-[2.25rem] leading-[1.05] font-medium tracking-tight text-stone-900">Marca</h2>
      </header>

      {brand?.logo_url && (
        <section>
          <SectionLabel>Logo</SectionLabel>
          <div className="hub-card p-10 flex items-center justify-center">
            <img src={brand.logo_url} alt="Logo" className="max-h-28 max-w-full object-contain" />
          </div>
        </section>
      )}

      {(brand?.primary_color || brand?.secondary_color) && (
        <section>
          <SectionLabel>Cores</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {brand.primary_color && <ColorSwatch color={brand.primary_color} label="Cor primária" />}
            {brand.secondary_color && <ColorSwatch color={brand.secondary_color} label="Cor secundária" />}
          </div>
        </section>
      )}

      {(brand?.font_primary || brand?.font_secondary) && (
        <section>
          <SectionLabel>Tipografia</SectionLabel>
          <div className="hub-card divide-y divide-stone-200/80">
            {brand.font_primary && (
              <div className="flex justify-between items-center px-5 py-4 text-sm">
                <span className="text-stone-500">Fonte principal</span>
                <span className="font-semibold text-stone-900">{brand.font_primary}</span>
              </div>
            )}
            {brand.font_secondary && (
              <div className="flex justify-between items-center px-5 py-4 text-sm">
                <span className="text-stone-500">Fonte secundária</span>
                <span className="font-semibold text-stone-900">{brand.font_secondary}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section>
          <SectionLabel>Arquivos</SectionLabel>
          <div className="space-y-2">
            {files.map(f => (
              <a key={f.id} href={f.file_url} download target="_blank" rel="noreferrer"
                className="hub-card hub-card-hover flex items-center justify-between px-5 py-4 group">
                <span className="text-[14px] font-semibold text-stone-900">{f.name}</span>
                <span className="flex items-center gap-2 text-[12px] text-stone-500 group-hover:text-stone-900 transition-colors">
                  Baixar
                  <Download size={15} />
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
