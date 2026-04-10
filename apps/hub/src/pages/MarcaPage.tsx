import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { useHub } from '../HubContext';
import { fetchBrand } from '../api';

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg border" style={{ backgroundColor: color }} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground uppercase">{color}</p>
      </div>
    </div>
  );
}

export function MarcaPage() {
  const { token } = useHub();
  const { data, isLoading } = useQuery({
    queryKey: ['hub-brand', token],
    queryFn: () => fetchBrand(token),
  });

  if (isLoading) return <div className="flex justify-center py-20"><div className="animate-spin h-6 w-6 rounded-full border-2 border-primary border-t-transparent" /></div>;

  const { brand, files } = data ?? { brand: null, files: [] };

  if (!brand && files.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <h2 className="text-xl font-semibold mb-4">Marca</h2>
        <p className="text-muted-foreground text-sm">Nenhum material de marca foi adicionado ainda.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h2 className="text-xl font-semibold">Marca</h2>

      {brand?.logo_url && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Logo</h3>
          <div className="border rounded-xl p-6 bg-white flex items-center justify-center">
            <img src={brand.logo_url} alt="Logo" className="max-h-24 max-w-full object-contain" />
          </div>
        </section>
      )}

      {(brand?.primary_color || brand?.secondary_color) && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Cores</h3>
          <div className="space-y-3">
            {brand.primary_color && <ColorSwatch color={brand.primary_color} label="Cor primária" />}
            {brand.secondary_color && <ColorSwatch color={brand.secondary_color} label="Cor secundária" />}
          </div>
        </section>
      )}

      {(brand?.font_primary || brand?.font_secondary) && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Tipografia</h3>
          <div className="space-y-2">
            {brand.font_primary && <div className="flex justify-between py-2 border-b text-sm"><span className="text-muted-foreground">Fonte principal</span><span className="font-medium">{brand.font_primary}</span></div>}
            {brand.font_secondary && <div className="flex justify-between py-2 text-sm"><span className="text-muted-foreground">Fonte secundária</span><span className="font-medium">{brand.font_secondary}</span></div>}
          </div>
        </section>
      )}

      {files.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Arquivos</h3>
          <div className="space-y-2">
            {files.map(f => (
              <a key={f.id} href={f.file_url} download target="_blank" rel="noreferrer"
                className="flex items-center justify-between border rounded-lg p-3 bg-white hover:bg-accent transition-colors">
                <span className="text-sm font-medium">{f.name}</span>
                <Download size={16} className="text-muted-foreground" />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
