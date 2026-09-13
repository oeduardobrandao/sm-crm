import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getHubBrand, upsertHubBrand, type HubBrandRow, type HubBrandFileRow } from '@/store';
// Estúdio's shared brand-aware controls (T3.5/T3.7 — one picker for canvas AND brand editing).
import { ColorPicker } from '@/components/shared/ColorPicker';
import { useFileUrl } from '@/hooks/useFileUrl';
import { uploadFile } from '@/services/fileService';
import { handleEntitlementMutationError } from '@/lib/entitlement-toast';
import { HubRoleGate, useHubPortalDataEnabled } from './HubRoleGate';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

export default function MarcaPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  // Tri-state: só um `can('configuracoes','editar')` resolvido como `true` libera a
  // busca; 'unknown' (membership ainda carregando) mantém a query desligada.
  const canLoadPortalData = useHubPortalDataEnabled();
  // An agent never sees the brand data (HubRoleGate below withholds it) — don't fetch it
  // just to discard it at render.
  const { data: brandData } = useQuery({
    queryKey: ['hub-brand-crm', clienteId],
    queryFn: () => getHubBrand(clienteId),
    enabled: canLoadPortalData,
  });

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">Marca</h2>
          <p className="hub-page__sub">Cores, fontes e referências da marca do cliente.</p>
        </div>
      </header>
      <HubRoleGate>
        {/* `key={clienteId}` força um remount inteiro ao trocar de cliente (Finding 3):
            sem ele, navegar de um cliente com `hub_brand` para um sem faz `brand` virar
            `null`, mas o estado local (`form`, `saving`, `uploadingLogo`) do componente
            ANTERIOR sobrevive -- e `save()` grava a logo/cores/fontes do cliente de
            origem sob o `clienteId` do destino. O reset de `form` no efeito abaixo já
            cobre o mesmo caso; o `key` é a segunda camada, e a que não depende de
            lembrar de manter os dois sincronizados se um novo campo de estado local for
            adicionado no futuro. */}
        <BrandEditor
          key={clienteId}
          clienteId={clienteId}
          contaId={cliente.conta_id}
          brand={brandData?.brand ?? null}
          files={brandData?.files ?? []}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-brand-crm', clienteId] })}
        />
      </HubRoleGate>
    </div>
  );
}

function BrandEditor({
  clienteId,
  contaId,
  brand,
  files,
  onSaved,
}: {
  clienteId: number;
  contaId: string;
  brand: HubBrandRow | null;
  files: HubBrandFileRow[];
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Partial<HubBrandRow>>(brand ?? {});
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const logoPreview = useFileUrl(brand?.logo_file_id ?? null);

  // Sincroniza SEMPRE com `brand`, mesmo quando ele resolve para `null` (Finding 3):
  // o guard antigo (`if (brand) setForm(brand)`) nunca limpava o formulário ao trocar
  // para um cliente sem `hub_brand` -- o form ficava com a logo/cores/fontes do
  // cliente ANTERIOR, e `save()` gravava esses valores sob o `clienteId` novo,
  // copiando a marca de um cliente para outro.
  useEffect(() => {
    setForm(brand ?? {});
  }, [brand]);

  async function save() {
    setSaving(true);
    try {
      // logo_file_id is owned by the upload flow below — never written by this button, so a
      // stale form (older tab, refetch race) can't null out a logo uploaded in the meantime.
      const { logo_file_id: _logoFileId, ...values } = form;
      await upsertHubBrand(clienteId, values);
      toast.success('Marca salva!');
      onSaved();
    } catch (e) {
      // trg_feature_brand gates hub_brand at the database, on a direct client
      // write with no edge function in the path and no TanStack mutation, so
      // App.tsx's MutationCache.onError never sees it. This catch is the only
      // observation point for feature_brand_customization.
      if (!handleEntitlementMutationError(e, contaId ?? null))
        toast.error('Não foi possível salvar a marca.');
    } finally {
      setSaving(false);
    }
  }

  // Logo file upload (Estúdio T3.7): saves logo_file_id IMMEDIATELY (own write, independent of
  // the "Salvar marca" button) — logo_url stays untouched, it remains what the Hub displays.
  async function uploadLogo(file: File) {
    setUploadingLogo(true);
    try {
      const record = await uploadFile({ file, folderId: null });
      await upsertHubBrand(clienteId, { logo_file_id: record.id });
      toast.success('Logo enviado!');
      onSaved();
    } catch (e) {
      // Same trigger, second write path into hub_brand.
      if (!handleEntitlementMutationError(e, contaId ?? null))
        toast.error('Não foi possível enviar o logo.');
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <section>
      <h3 className="font-semibold mb-3">Marca</h3>
      <div className="hub-brand-editor__grid grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label>URL do Logo</Label>
          <Input
            value={form.logo_url ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
            placeholder="https://..."
          />
        </div>
        <div>
          <Label>Logo (arquivo)</Label>
          <div className="flex items-center gap-3 mt-1">
            {logoPreview.data && (
              <img
                src={logoPreview.data}
                alt="Logo da marca"
                className="h-10 max-w-24 object-contain rounded border border-border p-0.5"
              />
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={uploadingLogo}
              onClick={() => logoInputRef.current?.click()}
            >
              <Upload size={14} className="mr-1.5" />
              {uploadingLogo ? 'Enviando…' : brand?.logo_file_id ? 'Trocar logo' : 'Enviar logo'}
            </Button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void uploadLogo(file);
              }}
            />
          </div>
        </div>
        <div>
          <Label>Cor primária</Label>
          <div className="flex items-center gap-2 mt-1">
            <ColorPicker
              value={form.primary_color ?? ''}
              label="Cor primária"
              onChange={(hex) => setForm((f) => ({ ...f, primary_color: hex }))}
            />
            {form.primary_color && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm((f) => ({ ...f, primary_color: null }))}
              >
                Limpar
              </Button>
            )}
          </div>
        </div>
        <div>
          <Label>Cor secundária</Label>
          <div className="flex items-center gap-2 mt-1">
            <ColorPicker
              value={form.secondary_color ?? ''}
              label="Cor secundária"
              onChange={(hex) => setForm((f) => ({ ...f, secondary_color: hex }))}
            />
            {form.secondary_color && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm((f) => ({ ...f, secondary_color: null }))}
              >
                Limpar
              </Button>
            )}
          </div>
        </div>
        <div>
          <Label>Fonte principal</Label>
          <Input
            value={form.font_primary ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, font_primary: e.target.value }))}
            placeholder="Inter"
          />
        </div>
        <div>
          <Label>Fonte secundária</Label>
          <Input
            value={form.font_secondary ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, font_secondary: e.target.value }))}
            placeholder="Playfair Display"
          />
        </div>
      </div>
      {files.length > 0 && (
        <div className="mt-3">
          <Label className="text-muted-foreground text-xs uppercase tracking-wide">Arquivos</Label>
          <div className="mt-1 space-y-1">
            {files.map((f) => (
              <div key={f.id} className="text-sm text-muted-foreground">
                {f.name}
              </div>
            ))}
          </div>
        </div>
      )}
      <Button size="sm" className="mt-3" onClick={save} disabled={saving}>
        <Save size={14} className="mr-1.5" /> Salvar marca
      </Button>
    </section>
  );
}
