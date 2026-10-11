import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Palette, Droplet, Type as TypeIcon, LayoutGrid, IdCard, Upload } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { PickerCell } from '@/components/mobile/PickerSheet';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { Spinner } from '@/components/ui/spinner';
import {
  ColorPicker as FigmaColorPicker,
  ColorPickerSelection,
  ColorPickerHue,
  ColorPickerEyeDropper,
  ColorPickerFormat,
} from '@/components/ui/color-picker-advanced';
import { FeatureGate } from '@/components/paywall/FeatureGate';
import { ConfigPhoneScreen, ConfigPhoneSkeleton } from '../../phone/ConfigPhoneScreen';
import { useConfigSubScreen } from '../../phone/useConfigSubScreen';
import {
  HubPreview,
  HUB_DISPLAY_FONTS,
  HUB_BODY_FONTS,
  type HubPreviewDraft,
} from '../../HubPreview';
// Same cross-boundary reach as HubPreview.tsx (see its header comment).
import {
  DEFAULT_HUB_THEME,
  PAUTA_FONTS,
  resolveHubTheme,
  type hubFontOptions,
  type HubSurface,
  type HubRadius,
  type HubCardStyle,
  type HubLook,
} from '../../../../../../hub/src/theme';
import {
  BRAND_PRESET_COLORS,
  SURFACE_OPTIONS,
  RADIUS_OPTIONS,
  CARD_STYLE_OPTIONS,
  LOGO_STYLE_OPTIONS,
  APPEARANCE_OPTIONS,
  SurfaceGlyph,
  RadiusGlyph,
  CardStyleGlyph,
  LogoGlyph,
  AccentChips,
} from './hubBrandingParts';
import './hubPhone.css';

type HubSection = 'aparencia' | 'cor' | 'tipografia' | 'componentes' | 'identidade';

export interface HubPhoneProps {
  /** Branding still loading: shows the grouped-list silhouette. */
  loading: boolean;
  canEdit: boolean;
  controlsDisabled: boolean;
  brandingFailed: boolean;
  customized: boolean;
  look: HubLook;
  pauta: boolean;
  workspaceName: string;
  workspaceLogoUrl: string | null;
  workspaceInitial: string;
  fontDisplayCss: string;
  previewDraft: HubPreviewDraft;
  fontOptions: ReturnType<typeof hubFontOptions>;

  setBrandColor: (v: string) => void;
  setSurface: (v: HubSurface) => void;
  setRadius: (v: HubRadius) => void;
  setCardStyle: (v: HubCardStyle) => void;
  setFontDisplay: (v: string) => void;
  setFontBody: (v: string) => void;
  setLogoStyle: (v: string) => void;
  setDefaultAppearance: (v: string) => void;
  setHideBranding: (v: boolean) => void;

  logoUploading: boolean;
  onLogoDarkUpload: (file: File) => void;
  removeLogoOpen: boolean;
  setRemoveLogoOpen: (open: boolean) => void;
  onRemoveLogoDark: () => void;

  saving: boolean;
  onSave: () => void;
}

const SECTION_TITLES: Record<HubSection, string> = {
  aparencia: 'Aparência',
  cor: 'Cor da marca',
  tipografia: 'Tipografia',
  componentes: 'Componentes',
  identidade: 'Identidade',
};

// Desktop SectionCard descriptions, reused as the sub-screens' subtitles.
const SECTION_SUBTITLES: Record<HubSection, string> = {
  aparencia: 'O clima geral do hub. O cliente ainda pode alternar claro e escuro.',
  cor: 'Aplicada a botões, navegação ativa e calendário. Contraste garantido.',
  tipografia: 'Comece por uma combinação pronta. Ajuste fino abaixo, se quiser.',
  componentes: 'A forma dos cards e controles do hub.',
  identidade: 'Como a marca da agência aparece dentro do hub.',
};

function labelOf<V extends string>(options: { value: V; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** A grid of "show me what it looks like" picks sized for a 390px screen. */
function PhoneOptionGrid<V extends string>({
  value,
  onChange,
  options,
  disabled,
  groupLabel,
  columns = 3,
}: {
  value: string;
  onChange: (value: V) => void;
  options: {
    value: V;
    label: string;
    sublabel?: string;
    glyph: ReactNode;
    style?: CSSProperties;
  }[];
  disabled?: boolean;
  groupLabel: string;
  columns?: 2 | 3;
}) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className={`phone-hub-grid phone-hub-grid--${columns}`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className="phone-hub-option"
          aria-pressed={value === opt.value}
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          style={opt.style}
        >
          <span className="phone-hub-option__glyph">{opt.glyph}</span>
          <span className="phone-hub-option__label">{opt.label}</span>
          {opt.sublabel && <span className="phone-hub-option__sublabel">{opt.sublabel}</span>}
        </button>
      ))}
    </div>
  );
}

/** A grouped card holding free content (an option grid, the colour picker). */
function BlockGroup({
  header,
  footer,
  children,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <GroupedList header={header} footer={footer}>
      <li className="phone-config-block phone-hub-block">{children}</li>
    </GroupedList>
  );
}

/** Miniature of the Hub home in the draft's resolved colours (the preview row's art). */
function PreviewThumb({
  draft,
  customized,
  look,
}: {
  draft: HubPreviewDraft;
  customized: boolean;
  look: HubLook;
}) {
  const config = customized
    ? {
        accent: draft.brandColor,
        surface: draft.surface,
        fontDisplay: draft.fontDisplay,
        fontBody: draft.fontBody,
        radius: draft.radius,
        cardStyle: draft.cardStyle,
        customized: true,
      }
    : { ...DEFAULT_HUB_THEME, accent: draft.brandColor, customized: false };
  const vars = resolveHubTheme(config, draft.defaultAppearance === 'dark', look)
    .vars as CSSProperties;
  return (
    <span className="phone-hub-thumb" aria-hidden="true">
      <span className="phone-hub-thumb__screen" style={vars}>
        <span className="phone-hub-thumb__top">
          <span className="phone-hub-thumb__logo" />
          <span className="phone-hub-thumb__bar" />
        </span>
        <span className="phone-hub-thumb__title" />
        <span className="phone-hub-thumb__card" />
        <span className="phone-hub-thumb__card" />
        <span className="phone-hub-thumb__cta" />
      </span>
    </span>
  );
}

/**
 * Configurações > Hub on phones: a live-preview row opening a full-height sheet, the
 * five "Personalizar" sections as pushed sub-screens, the "powered by" switch and a
 * Salvar bar. Presentational: the draft, the save and the dark-logo handlers all live
 * in HubTab, so a sub-screen edit and the preview read the same unsaved state.
 */
export function HubPhone(props: HubPhoneProps) {
  const {
    loading,
    canEdit,
    controlsDisabled,
    brandingFailed,
    customized,
    look,
    workspaceName,
    workspaceLogoUrl,
    previewDraft: draft,
    fontOptions,
  } = props;
  const sub = useConfigSubScreen<HubSection>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const saveBar = (
    <BottomActionBar aboveTabBar>
      <button
        type="button"
        className="phone-config-primary phone-config-primary--block"
        onClick={props.onSave}
        disabled={props.saving || controlsDisabled}
        aria-busy={props.saving || undefined}
      >
        {props.saving && <Spinner size="sm" />} Salvar
      </button>
    </BottomActionBar>
  );

  const failedNote = brandingFailed && (
    <p role="alert" className="phone-hub-alert">
      Não foi possível carregar as configurações do Hub. Recarregue a página. Salvar agora
      sobrescreveria a sua personalização com os valores padrão.
    </p>
  );

  if (sub.screen) {
    const section = sub.screen;
    return (
      <ConfigPhoneScreen
        title={SECTION_TITLES[section]}
        subtitle={SECTION_SUBTITLES[section]}
        onBack={sub.close}
        backLabel="Voltar para Hub"
      >
        {section === 'cor' ? (
          <BrandColorSection {...props} />
        ) : (
          <FeatureGate flag="feature_brand_customization" label="Personalização do Hub">
            {section === 'aparencia' && <AppearanceSection {...props} />}
            {section === 'tipografia' && <TypographySection {...props} />}
            {section === 'componentes' && <ComponentsSection {...props} />}
            {section === 'identidade' && (
              <IdentitySection
                {...props}
                onPickLogo={() => logoInputRef.current?.click()}
                logoInput={
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    disabled={!canEdit}
                    data-testid="hub-phone-logo-input"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file && canEdit) props.onLogoDarkUpload(file);
                    }}
                  />
                }
              />
            )}
          </FeatureGate>
        )}
        {failedNote}
        {saveBar}
      </ConfigPhoneScreen>
    );
  }

  if (loading) {
    return (
      <ConfigPhoneScreen title="Hub" subtitle="Como o Hub aparece para os seus clientes.">
        <ConfigPhoneSkeleton groups={3} rows={2} />
      </ConfigPhoneScreen>
    );
  }

  const matchedPairing = fontOptions.pairings.find(
    (p) => p.display === draft.fontDisplay && p.body === draft.fontBody,
  );
  const typographyValue =
    matchedPairing?.label ??
    `${HUB_DISPLAY_FONTS[draft.fontDisplay]?.label ?? draft.fontDisplay} · ${
      HUB_BODY_FONTS[draft.fontBody]?.label ?? draft.fontBody
    }`;

  const sectionCell = (section: HubSection, icon: ReactNode, value: ReactNode) => (
    <Cell
      key={section}
      className="phone-hub-section-cell"
      label={SECTION_TITLES[section]}
      icon={icon}
      iconColor="var(--phone-fill)"
      value={value}
      chevron
      onClick={() => sub.open(section)}
    />
  );

  return (
    <ConfigPhoneScreen title="Hub" subtitle="Como o Hub aparece para os seus clientes.">
      <GroupedList aria-label="Pré-visualização" footer={canEdit ? undefined : 'Somente leitura'}>
        <Cell
          className="phone-hub-preview-cell"
          label="Pré-visualização ao vivo"
          subtitle="Veja o Hub como o cliente vê. Celular ou computador, claro ou escuro."
          icon={<PreviewThumb draft={draft} customized={customized} look={look} />}
          chevron
          aria-haspopup="dialog"
          onClick={() => setPreviewOpen(true)}
        />
      </GroupedList>

      <GroupedList header="Personalizar">
        {sectionCell(
          'aparencia',
          <Palette />,
          `${labelOf(SURFACE_OPTIONS, draft.surface)} · ${labelOf(
            APPEARANCE_OPTIONS,
            draft.defaultAppearance,
          )}`,
        )}
        {sectionCell(
          'cor',
          <Droplet />,
          <span className="phone-hub-color-value">
            <span
              className="phone-hub-color-dot"
              style={{ background: draft.brandColor }}
              aria-hidden="true"
            />
            {draft.brandColor.toUpperCase()}
          </span>,
        )}
        {sectionCell('tipografia', <TypeIcon />, typographyValue)}
        {sectionCell(
          'componentes',
          <LayoutGrid />,
          `${labelOf(RADIUS_OPTIONS, draft.radius)} · ${labelOf(CARD_STYLE_OPTIONS, draft.cardStyle)}`,
        )}
        {sectionCell('identidade', <IdCard />, labelOf(LOGO_STYLE_OPTIONS, draft.logoStyle))}
      </GroupedList>

      <FeatureGate flag="feature_brand_customization" label="Personalização do Hub">
        <GroupedList aria-label="Marca Mesaas">
          <Cell
            label='Ocultar "powered by mesaas"'
            disabled={controlsDisabled}
            switch={{ checked: draft.hideBranding, onCheckedChange: props.setHideBranding }}
          />
        </GroupedList>
      </FeatureGate>

      {failedNote}
      {saveBar}

      <BottomSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Pré-visualização ao vivo"
        hideTitle
        detents={['large']}
        className="phone-hub-preview-sheet"
      >
        <div className="phone-hub-preview">
          <HubPreview
            draft={draft}
            workspaceName={workspaceName}
            workspaceLogoUrl={workspaceLogoUrl}
            customized={customized}
            look={look}
            initialDevice="mobile"
          />
        </div>
      </BottomSheet>
    </ConfigPhoneScreen>
  );
}

function AppearanceSection(props: HubPhoneProps) {
  const { previewDraft: draft, controlsDisabled } = props;
  return (
    <>
      <BlockGroup header="Tema de superfície">
        <PhoneOptionGrid<HubSurface>
          groupLabel="Tema de superfície"
          value={draft.surface}
          onChange={props.setSurface}
          disabled={controlsDisabled}
          options={SURFACE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            glyph: <SurfaceGlyph surface={opt.value} />,
          }))}
        />
      </BlockGroup>
      <BlockGroup header="Aparência padrão" footer="O cliente ainda pode alternar no hub.">
        <SegmentedControl
          aria-label="Aparência padrão"
          value={draft.defaultAppearance}
          onChange={props.setDefaultAppearance}
          options={APPEARANCE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: (
              <span className="phone-hub-segment-label">
                <opt.icon aria-hidden="true" />
                {opt.label}
              </span>
            ),
            ariaLabel: opt.label,
            disabled: controlsDisabled,
          }))}
        />
      </BlockGroup>
    </>
  );
}

function BrandColorSection(props: HubPhoneProps) {
  const { previewDraft: draft, controlsDisabled } = props;
  const brandColor = draft.brandColor;
  return (
    <>
      <BlockGroup header="Cores sugeridas">
        <div role="group" aria-label="Cores sugeridas" className="phone-hub-swatches">
          {BRAND_PRESET_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              className="phone-hub-swatch"
              aria-label={hex}
              aria-pressed={brandColor.toLowerCase() === hex.toLowerCase()}
              disabled={controlsDisabled}
              onClick={() => props.setBrandColor(hex)}
              style={{ background: hex }}
            />
          ))}
        </div>
      </BlockGroup>
      <BlockGroup
        header="Cor personalizada"
        footer="A mesma cor do relatório mensal. Marca o calendário do Hub e os destaques do relatório."
      >
        {/* Same picker and hex-only contract as desktop (see HubTab), full width. */}
        <FigmaColorPicker
          value={brandColor}
          onChange={props.setBrandColor}
          disabled={controlsDisabled}
          style={{ gap: '0.75rem' }}
        >
          <ColorPickerSelection style={{ height: 160 }} />
          <ColorPickerHue />
          <div className="phone-hub-picker-row">
            <div
              role="img"
              aria-label={`Cor selecionada: ${brandColor}`}
              className="phone-hub-picker-swatch"
              style={{ background: brandColor }}
            />
            <ColorPickerEyeDropper />
            <ColorPickerFormat />
          </div>
        </FigmaColorPicker>
        <AccentChips brandColor={brandColor} />
      </BlockGroup>
    </>
  );
}

function TypographySection(props: HubPhoneProps) {
  const { previewDraft: draft, controlsDisabled, fontOptions, pauta } = props;
  return (
    <>
      <BlockGroup header="Combinações sugeridas">
        <PhoneOptionGrid<string>
          groupLabel="Combinações de fontes sugeridas"
          columns={2}
          value={
            fontOptions.pairings.find(
              (p) => p.display === draft.fontDisplay && p.body === draft.fontBody,
            )?.label ?? ''
          }
          onChange={(label) => {
            const pairing = fontOptions.pairings.find((p) => p.label === label);
            if (!pairing) return;
            props.setFontDisplay(pairing.display);
            props.setFontBody(pairing.body);
          }}
          disabled={controlsDisabled}
          options={fontOptions.pairings.map((pairing) => {
            const displayFont = HUB_DISPLAY_FONTS[pairing.display];
            const bodyFont = HUB_BODY_FONTS[pairing.body];
            return {
              value: pairing.label,
              label:
                pauta && pairing.display === PAUTA_FONTS.display
                  ? `${pairing.label} · Padrão`
                  : pairing.label,
              sublabel: `${displayFont?.label ?? ''} · ${bodyFont?.label ?? ''}`,
              glyph: (
                <span className="phone-hub-specimen" style={{ fontFamily: displayFont?.css }}>
                  Ag
                </span>
              ),
            };
          })}
        />
      </BlockGroup>
      <GroupedList header="Escolher fontes separadamente">
        <PickerCell<string>
          label="Fonte de títulos"
          value={draft.fontDisplay}
          onChange={(v) => v && props.setFontDisplay(v)}
          disabled={controlsDisabled}
          options={fontOptions.display.map(([id, font]) => ({
            value: id,
            label: <span style={{ fontFamily: font.css }}>{font.label}</span>,
            searchText: font.label,
          }))}
        />
        <PickerCell<string>
          label="Fonte de texto"
          value={draft.fontBody}
          onChange={(v) => v && props.setFontBody(v)}
          disabled={controlsDisabled}
          options={fontOptions.body.map(([id, font]) => ({
            value: id,
            label: <span style={{ fontFamily: font.css }}>{font.label}</span>,
            searchText: font.label,
          }))}
        />
      </GroupedList>
    </>
  );
}

function ComponentsSection(props: HubPhoneProps) {
  const { previewDraft: draft, controlsDisabled } = props;
  return (
    <>
      <BlockGroup header="Cantos">
        <PhoneOptionGrid<HubRadius>
          groupLabel="Cantos"
          value={draft.radius}
          onChange={props.setRadius}
          disabled={controlsDisabled}
          options={RADIUS_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            glyph: <RadiusGlyph radius={opt.value} />,
          }))}
        />
      </BlockGroup>
      <BlockGroup header="Estilo de cards">
        <PhoneOptionGrid<HubCardStyle>
          groupLabel="Estilo de cards"
          value={draft.cardStyle}
          onChange={props.setCardStyle}
          disabled={controlsDisabled}
          options={CARD_STYLE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            glyph: <CardStyleGlyph cardStyle={opt.value} />,
          }))}
        />
      </BlockGroup>
    </>
  );
}

function IdentitySection(props: HubPhoneProps & { onPickLogo: () => void; logoInput: ReactNode }) {
  const {
    previewDraft: draft,
    controlsDisabled,
    canEdit,
    logoUploading,
    workspaceInitial,
    workspaceName,
    fontDisplayCss,
  } = props;
  const logoDarkUrl = draft.logoDarkUrl;
  return (
    <>
      <BlockGroup header="Logo no hub">
        <PhoneOptionGrid<string>
          groupLabel="Logo no hub"
          columns={2}
          value={draft.logoStyle}
          onChange={props.setLogoStyle}
          disabled={controlsDisabled}
          options={LOGO_STYLE_OPTIONS.map((opt) => ({
            value: opt.value,
            label: opt.label,
            sublabel: opt.sublabel,
            glyph: (
              <LogoGlyph
                kind={opt.value as 'round' | 'wordmark'}
                brandColor={draft.brandColor}
                initial={workspaceInitial}
                workspaceName={workspaceName}
                fontDisplayCss={fontDisplayCss}
              />
            ),
          }))}
        />
      </BlockGroup>

      <GroupedList
        header="Logo para modo escuro"
        footer="PNG · até 2MB. Usada quando o cliente está no modo escuro."
      >
        {logoDarkUrl && (
          <li className="phone-config-block phone-hub-block">
            <img
              src={logoDarkUrl}
              alt="Logo para modo escuro"
              className="phone-hub-dark-logo"
              style={{ opacity: logoUploading ? 0.5 : 1 }}
            />
          </li>
        )}
        <Cell
          id="hub-logo-dark-trigger"
          label={
            logoUploading
              ? 'Enviando…'
              : logoDarkUrl
                ? 'Trocar logo'
                : 'Enviar variante clara do logo'
          }
          icon={logoUploading ? <Spinner size="sm" /> : <Upload />}
          disabled={logoUploading || !canEdit}
          onClick={props.onPickLogo}
        />
        {logoDarkUrl && (
          <Cell
            label="Remover"
            destructive
            disabled={logoUploading || !canEdit}
            onClick={() => props.setRemoveLogoOpen(true)}
          />
        )}
      </GroupedList>
      {props.logoInput}

      <PhoneConfirmSheet
        open={props.removeLogoOpen}
        title="Remover a logo para modo escuro?"
        actions={[
          {
            label: 'Remover',
            destructive: true,
            disabled: logoUploading || !canEdit,
            onSelect: props.onRemoveLogoDark,
          },
        ]}
        onCancel={() => props.setRemoveLogoOpen(false)}
      />
    </>
  );
}
