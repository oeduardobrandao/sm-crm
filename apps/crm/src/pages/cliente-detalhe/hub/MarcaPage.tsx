import { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
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
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import '../phone/clienteDetalhePhone.css';

export default function MarcaPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  const { t } = useTranslation('clientHub');
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

  const isPhone = !useIsDesktop(768);

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      {!isPhone && (
        <header className="hub-page__head">
          <div>
            <h2 className="hub-page__title">{t('marca.title')}</h2>
            <p className="hub-page__sub">{t('marca.subtitle')}</p>
          </div>
        </header>
      )}
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
  const isPhone = !useIsDesktop(768);
  const { t } = useTranslation('clientHub');

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
      toast.success(t('marca.saved'));
      onSaved();
    } catch (e) {
      // trg_feature_brand gates hub_brand at the database, on a direct client
      // write with no edge function in the path and no TanStack mutation, so
      // App.tsx's MutationCache.onError never sees it. This catch is the only
      // observation point for feature_brand_customization.
      if (!handleEntitlementMutationError(e, contaId ?? null)) toast.error(t('marca.saveError'));
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
      toast.success(t('marca.logoUploaded'));
      onSaved();
    } catch (e) {
      // Same trigger, second write path into hub_brand.
      if (!handleEntitlementMutationError(e, contaId ?? null))
        toast.error(t('marca.logoUploadError'));
    } finally {
      setUploadingLogo(false);
    }
  }

  const logoInput = (
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
  );

  if (isPhone) {
    const colorRow = (label: string, key: 'primary_color' | 'secondary_color') => (
      <FormRow label={label}>
        {(field) => (
          <span className="phone-cli-marca__color">
            {form[key] && (
              <button
                type="button"
                className="phone-cli-link-button"
                onClick={() => setForm((f) => ({ ...f, [key]: null }))}
              >
                {t('ui.clear')}
              </button>
            )}
            <span id={field.id}>
              <ColorPicker
                value={form[key] ?? ''}
                label={label}
                onChange={(hex) => setForm((f) => ({ ...f, [key]: hex }))}
              />
            </span>
          </span>
        )}
      </FormRow>
    );
    return (
      <div className="phone-cli-marca">
        <GroupedList header={t('marca.logoHeader')}>
          <FormRow
            label={t('marca.logoUrl')}
            layout="stacked"
            input={{
              value: form.logo_url ?? '',
              onChange: (e) => setForm((f) => ({ ...f, logo_url: e.target.value })),
              placeholder: 'https://...',
              inputMode: 'url',
              autoCapitalize: 'none',
            }}
          />
          <Cell
            label={
              uploadingLogo
                ? t('marca.uploading')
                : brand?.logo_file_id
                  ? t('marca.replaceLogo')
                  : t('marca.uploadLogo')
            }
            icon={
              logoPreview.data ? (
                <img
                  src={logoPreview.data}
                  alt={t('marca.logoAlt')}
                  className="phone-cli-marca__logo"
                />
              ) : (
                <Upload />
              )
            }
            disabled={uploadingLogo}
            onClick={() => logoInputRef.current?.click()}
          />
        </GroupedList>
        {logoInput}
        <GroupedList header={t('marca.colors')}>
          {colorRow(t('marca.primaryColor'), 'primary_color')}
          {colorRow(t('marca.secondaryColor'), 'secondary_color')}
        </GroupedList>
        <GroupedList header={t('marca.fonts')}>
          <FormRow
            label={t('marca.fontPrimary')}
            input={{
              value: form.font_primary ?? '',
              onChange: (e) => setForm((f) => ({ ...f, font_primary: e.target.value })),
              placeholder: 'Inter',
            }}
          />
          <FormRow
            label={t('marca.fontSecondary')}
            input={{
              value: form.font_secondary ?? '',
              onChange: (e) => setForm((f) => ({ ...f, font_secondary: e.target.value })),
              placeholder: 'Playfair Display',
            }}
          />
        </GroupedList>
        {files.length > 0 && (
          <GroupedList header={t('marca.files')} className="phone-cli-wrap">
            {files.map((f) => (
              <Cell key={f.id} label={f.name} />
            ))}
          </GroupedList>
        )}
        <button
          type="button"
          className="phone-cli-button phone-cli-button--block"
          onClick={save}
          disabled={saving}
        >
          <Save aria-hidden="true" /> {t('marca.save')}
        </button>
      </div>
    );
  }

  return (
    <section>
      <h3 className="font-semibold mb-3">{t('marca.title')}</h3>
      <div className="hub-brand-editor__grid grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label>{t('marca.logoUrl')}</Label>
          <Input
            value={form.logo_url ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
            placeholder="https://..."
          />
        </div>
        <div>
          <Label>{t('marca.logoFile')}</Label>
          <div className="flex items-center gap-3 mt-1">
            {logoPreview.data && (
              <img
                src={logoPreview.data}
                alt={t('marca.logoAlt')}
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
              {uploadingLogo
                ? t('marca.uploading')
                : brand?.logo_file_id
                  ? t('marca.replaceLogo')
                  : t('marca.uploadLogo')}
            </Button>
            {logoInput}
          </div>
        </div>
        <div>
          <Label>{t('marca.primaryColor')}</Label>
          <div className="flex items-center gap-2 mt-1">
            <ColorPicker
              value={form.primary_color ?? ''}
              label={t('marca.primaryColor')}
              onChange={(hex) => setForm((f) => ({ ...f, primary_color: hex }))}
            />
            {form.primary_color && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm((f) => ({ ...f, primary_color: null }))}
              >
                {t('ui.clear')}
              </Button>
            )}
          </div>
        </div>
        <div>
          <Label>{t('marca.secondaryColor')}</Label>
          <div className="flex items-center gap-2 mt-1">
            <ColorPicker
              value={form.secondary_color ?? ''}
              label={t('marca.secondaryColor')}
              onChange={(hex) => setForm((f) => ({ ...f, secondary_color: hex }))}
            />
            {form.secondary_color && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setForm((f) => ({ ...f, secondary_color: null }))}
              >
                {t('ui.clear')}
              </Button>
            )}
          </div>
        </div>
        <div>
          <Label>{t('marca.fontPrimary')}</Label>
          <Input
            value={form.font_primary ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, font_primary: e.target.value }))}
            placeholder="Inter"
          />
        </div>
        <div>
          <Label>{t('marca.fontSecondary')}</Label>
          <Input
            value={form.font_secondary ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, font_secondary: e.target.value }))}
            placeholder="Playfair Display"
          />
        </div>
      </div>
      {files.length > 0 && (
        <div className="mt-3">
          <Label className="text-muted-foreground text-xs uppercase tracking-wide">
            {t('marca.files')}
          </Label>
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
        <Save size={14} className="mr-1.5" /> {t('marca.save')}
      </Button>
    </section>
  );
}
