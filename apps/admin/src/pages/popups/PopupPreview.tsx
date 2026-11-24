import { useId, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Maximize2 } from 'lucide-react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { PopupCard, type PopupCardProps } from '@mesaas/ui/PopupCard';
import {
  LIVE_POPUP_MAX_WIDTH,
  previewHref,
  previewPageStyle,
  previewScrimStyle,
  previewStageStyle,
  previewThemeVars,
  type PreviewLook,
  type PreviewTheme,
} from './popup-preview';
import type { PopupEditorModel } from './editor-model';

const THEME_OPTIONS: { value: PreviewTheme; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

const LOOK_OPTIONS: { value: PreviewLook; label: string }[] = [
  { value: 'vidro', label: 'Vidro' },
  { value: 'classic', label: 'Clássico' },
];

type CardHandlers = 'onCta' | 'onSecondary' | 'onClose' | 'titleId' | 'bodyId';

function cardProps(m: PopupEditorModel): Omit<PopupCardProps, CardHandlers> {
  const { form } = m;
  return {
    pages: form.pages.map((p) => ({
      title: p.title || 'Título',
      eyebrow: p.eyebrow || null,
      body: p.body || 'Prévia do corpo…',
      imageUrl: p.image_key ? (m.imageUrls?.[p.image_key] ?? null) : null,
      ctaLabel: p.cta_label.trim() && p.cta_url.trim() ? p.cta_label.trim() : null,
    })),
    page: m.pageIndex,
    onPageChange: m.selectPage,
    ctaLabel: m.hasCta ? form.cta_label : null,
    ctaStyle: form.cta_style,
    secondaryLabel: m.secondaryLabel,
    requireAck: form.require_ack,
    sanitizeHref: previewHref,
  };
}

const noop = () => {};

/**
 * Prévia ao vivo: o PopupCard exato do CRM, na largura real (até 420px, como o
 * GlobalPopupHost), sobre o fundo da página do CRM coberto pelo mesmo véu. O véu e a borda do
 * card mudam com o visual: Vidro (padrão no computador) ou clássico (iPhone e quem desligou o
 * Vidro). "Tela cheia" abre o popup como o usuário vê: centralizado na tela, sobre o véu.
 */
export function PopupPreview({
  m,
  fullBleed = false,
}: {
  m: PopupEditorModel;
  /** iPhone: o palco ocupa a largura da tela, como o popup ao vivo. */
  fullBleed?: boolean;
}) {
  const titleId = useId();
  const bodyId = useId();
  const [fullscreen, setFullscreen] = useState(false);
  // O app do CRM no iPhone não tem Vidro; no computador ele é o padrão.
  const [look, setLook] = useState<PreviewLook>(fullBleed ? 'classic' : 'vidro');
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="whitespace-nowrap text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          Prévia ao vivo
        </span>
        <button
          type="button"
          onClick={() => setFullscreen(true)}
          className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          Tela cheia
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          aria-label="Tema da prévia"
          // Segmentos flex:1 dividem a largura intrínseca por igual e cortavam "Escuro".
          className="min-w-[136px]"
          options={THEME_OPTIONS}
          value={m.theme}
          onChange={m.setTheme}
        />
        <SegmentedControl
          aria-label="Visual do CRM"
          className="min-w-[148px]"
          options={LOOK_OPTIONS}
          value={look}
          onChange={setLook}
        />
      </div>
      {/* No iPhone o palco vaza o respiro de 16px da folha: o card fica com a largura da tela
          menos 32px, a mesma do popup ao vivo (w-[calc(100%-32px)]). */}
      <div
        className={
          fullBleed
            ? 'relative -mx-4 flex justify-center overflow-hidden px-4 py-10'
            : 'relative flex justify-center overflow-hidden rounded-[16px] px-3 py-10'
        }
        style={previewStageStyle(m.theme, look)}
        data-testid="popup-preview-stage"
        data-look={look}
      >
        <div
          className="absolute inset-0"
          style={previewScrimStyle(m.theme, look)}
          aria-hidden="true"
        />
        <div className="relative w-full" style={{ maxWidth: LIVE_POPUP_MAX_WIDTH }}>
          <PopupCard
            {...cardProps(m)}
            onCta={m.anyCta ? noop : undefined}
            onSecondary={noop}
            onClose={noop}
            titleId={titleId}
            bodyId={bodyId}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Componente exato do CRM, na largura real. Vidro é o visual do CRM no computador; no iPhone o
        CRM usa o clássico. Navegar aqui seleciona a aba da página.
      </p>
      <PopupFullscreenPreview m={m} look={look} open={fullscreen} onOpenChange={setFullscreen} />
    </div>
  );
}

/** O popup como o GlobalPopupHost do CRM o monta: fundo do CRM, véu e card centralizado. */
function PopupFullscreenPreview({
  m,
  look,
  open,
  onOpenChange,
}: {
  m: PopupEditorModel;
  look: PreviewLook;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const titleId = useId();
  const bodyId = useId();
  const close = () => onOpenChange(false);
  const title = m.form.pages[m.pageIndex]?.title || 'Título';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* z acima da folha do editor (BottomSheet do ios-kit usa 9011 no iPhone). */}
        {/* O fundo da página do CRM no lugar do Admin, para o véu claro do Vidro não mostrar o
            editor por baixo. */}
        <div
          className="fixed inset-0 z-[9100]"
          style={previewPageStyle(m.theme, look)}
          aria-hidden="true"
        />
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-[9101]"
          style={previewScrimStyle(m.theme, look)}
        />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[9102] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2 outline-none"
          style={{ ...previewThemeVars(m.theme, look), maxWidth: LIVE_POPUP_MAX_WIDTH }}
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          <DialogPrimitive.Title asChild>
            <span className="sr-only" aria-hidden="true">
              {title}
            </span>
          </DialogPrimitive.Title>
          <PopupCard
            {...cardProps(m)}
            onCta={m.anyCta ? close : undefined}
            onSecondary={close}
            onClose={close}
            titleId={titleId}
            bodyId={bodyId}
          />
          {/* Sair da prévia mesmo com "exigir confirmação", que esconde o × do card. Fica dentro
              do Content (acima do card, fora dele) para o Radix não escondê-lo do leitor de tela. */}
          <DialogPrimitive.Close className="absolute bottom-full right-0 mb-3 rounded-full bg-[rgba(18,21,26,0.78)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[rgba(18,21,26,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            Sair da prévia
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
