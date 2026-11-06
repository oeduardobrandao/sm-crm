import { useId } from 'react';
import { SegmentedControl } from '@mesaas/ios-kit';
import { PopupCard } from '@mesaas/ui/PopupCard';
import { previewHref, previewStageStyle, type PreviewTheme } from './popup-preview';
import type { PopupEditorModel } from './editor-model';

const THEME_OPTIONS: { value: PreviewTheme; label: string }[] = [
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
];

/** Prévia ao vivo: o PopupCard exato do CRM, pintado com os tokens do tema escolhido. */
export function PopupPreview({ m }: { m: PopupEditorModel }) {
  const titleId = useId();
  const bodyId = useId();
  const { form } = m;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted-foreground">
          Prévia ao vivo
        </span>
        <SegmentedControl
          aria-label="Tema da prévia"
          options={THEME_OPTIONS}
          value={m.theme}
          onChange={m.setTheme}
        />
      </div>
      <div className="flex justify-center rounded-[16px] p-3" style={previewStageStyle(m.theme)}>
        <PopupCard
          pages={form.pages.map((p) => ({
            title: p.title || 'Título',
            eyebrow: p.eyebrow || null,
            body: p.body || 'Prévia do corpo…',
            imageUrl: p.image_key ? (m.imageUrls?.[p.image_key] ?? null) : null,
            ctaLabel: p.cta_label.trim() && p.cta_url.trim() ? p.cta_label.trim() : null,
          }))}
          page={m.pageIndex}
          onPageChange={m.selectPage}
          ctaLabel={m.hasCta ? form.cta_label : null}
          ctaStyle={form.cta_style}
          secondaryLabel={m.secondaryLabel}
          requireAck={form.require_ack}
          sanitizeHref={previewHref}
          onCta={m.anyCta ? () => {} : undefined}
          onSecondary={() => {}}
          onClose={() => {}}
          titleId={titleId}
          bodyId={bodyId}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Componente exato do CRM. Navegar aqui seleciona a aba da página.
      </p>
    </div>
  );
}
