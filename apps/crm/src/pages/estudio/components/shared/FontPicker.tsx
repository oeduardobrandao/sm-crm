// T3.4 FontPicker (docs/estudio-design.md §6.1 shared/ + §7, plan §4): replaces the T2.12
// stopgap <select>. Popover+Command combobox with the "Marca" section pinned FIRST (the
// client's hub_brand font names resolved through the shared matcher — an unmatched brand font
// renders as a DISABLED "não incluída no Estúdio" row, never a silent substitution), followed
// by the manifest's four vibe groups.
//
// Preview strips (§7): every row renders the family name in the family itself, using the
// build-generated ~3KB name-stripped woff2 (`family.preview`) — FontFace'd LAZILY via
// IntersectionObserver so opening the picker doesn't fetch 26 files up front, only the rows
// actually scrolled into view. Loaded faces are cached module-scope (document.fonts is
// page-global anyway).
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronsUpDown } from 'lucide-react';
import rawManifest from '@mesaas/fonts/manifest.json';
import type { FontFamily, FontManifest } from '@mesaas/fonts/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { familiesByGroup, findFamily } from '../../hooks/useFontManifest';

const FONT_MANIFEST = rawManifest as unknown as FontManifest;

export function previewFontFamilyName(key: string): string {
  return `estudio-preview-${key}`;
}

// Module-scope so faces survive picker unmounts — document.fonts is page-global anyway.
const loadedPreviews = new Set<string>();
const previewPromises = new Map<string, Promise<void>>();

function loadPreviewFont(family: FontFamily): Promise<void> {
  if (loadedPreviews.has(family.key)) return Promise.resolve();
  let promise = previewPromises.get(family.key);
  if (!promise) {
    promise = (async () => {
      const face = new FontFace(
        previewFontFamilyName(family.key),
        `url(${family.preview}?v=${FONT_MANIFEST.version})`,
      );
      await face.load();
      document.fonts.add(face);
      loadedPreviews.add(family.key);
    })().catch(() => {
      // A failed preview fetch degrades to the cssFallback rendering — allow a retry next time.
      previewPromises.delete(family.key);
    });
    previewPromises.set(family.key, promise);
  }
  return promise;
}

/** The family name rendered in its own font, lazily loaded when the row scrolls into view. */
function FamilyPreview({ family }: { family: FontFamily }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [ready, setReady] = useState(() => loadedPreviews.has(family.key));

  useEffect(() => {
    if (ready) return;
    const el = ref.current;
    if (!el) return;
    const load = () =>
      void loadPreviewFont(family).then(() => {
        if (loadedPreviews.has(family.key)) setReady(true);
      });
    if (typeof IntersectionObserver === 'undefined') {
      load(); // jsdom/tests and ancient browsers: skip the laziness, keep the behavior
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [family, ready]);

  return (
    <span
      ref={ref}
      style={{
        fontFamily: ready
          ? `'${previewFontFamilyName(family.key)}', ${family.cssFallback}`
          : family.cssFallback,
        fontSize: '1rem',
        lineHeight: 1.2,
      }}
    >
      {family.name}
    </span>
  );
}

export interface BrandFontEntry {
  /** The raw hub_brand font name as the user typed it. */
  raw: string;
  /** The matcher-resolved manifest key, or null when unmatched/ambiguous (T3.1 — resolved by
   * the caller through `matchBrandFont`, so picker and MCP share one matching behavior). */
  key: string | null;
}

export interface FontPickerProps {
  /** The selected layer's font_key. */
  value: string;
  /** Called with the picked manifest family key — the caller owns the weight/style fallback
   * patch (buildFontFamilyPatch). */
  onSelect: (familyKey: string) => void;
  /** Client brand fonts, pinned first as the "Marca" group. */
  brandFonts?: BrandFontEntry[];
  id?: string;
  disabled?: boolean;
}

export function FontPicker({ value, onSelect, brandFonts = [], id, disabled }: FontPickerProps) {
  const { t } = useTranslation('estudio');
  const [open, setOpen] = useState(false);
  const current = findFamily(value);
  const groups = familiesByGroup();

  const pick = (key: string) => {
    setOpen(false);
    if (key !== value) onSelect(key);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-label={t('fontPicker.open')}
          disabled={disabled}
          data-testid="estudio-font-trigger"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            minWidth: 160,
            padding: '0.4rem 0.6rem',
            borderRadius: 8,
            border: '1px solid var(--border-color)',
            background: 'var(--surface-main)',
            color: 'var(--text-main)',
            fontSize: '0.8rem',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          {current?.name ?? value}
          <ChevronsUpDown size={14} style={{ opacity: 0.5, flexShrink: 0 }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={t('fontPicker.search')} />
          <CommandList style={{ maxHeight: 320 }}>
            <CommandEmpty>{t('fontPicker.empty')}</CommandEmpty>

            {brandFonts.length > 0 && (
              <CommandGroup heading={t('fontPicker.brand')}>
                {brandFonts.map((entry) => {
                  const family = entry.key ? findFamily(entry.key) : undefined;
                  if (!family) {
                    return (
                      <CommandItem
                        key={`brand-${entry.raw}`}
                        value={`marca ${entry.raw}`}
                        disabled
                        data-testid="estudio-font-brand-unmatched"
                      >
                        <span style={{ color: 'var(--text-muted)' }}>
                          {entry.raw} — {t('fontPicker.notIncluded')}
                        </span>
                      </CommandItem>
                    );
                  }
                  return (
                    <CommandItem
                      key={`brand-${entry.raw}`}
                      value={`marca ${entry.raw} ${family.name} ${family.key}`}
                      onSelect={() => pick(family.key)}
                      data-testid="estudio-font-brand-matched"
                    >
                      <Check
                        size={14}
                        style={{ opacity: family.key === value ? 1 : 0, marginRight: 6 }}
                      />
                      <FamilyPreview family={family} />
                      {family.name.toLowerCase() !== entry.raw.trim().toLowerCase() && (
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: '0.7rem',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {entry.raw}
                        </span>
                      )}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}

            {groups.map((group) => (
              <CommandGroup key={group.group} heading={group.label}>
                {group.families.map((family) => (
                  <CommandItem
                    key={family.key}
                    value={`${family.name} ${family.key} ${family.aliases.join(' ')}`}
                    onSelect={() => pick(family.key)}
                  >
                    <Check
                      size={14}
                      style={{ opacity: family.key === value ? 1 : 0, marginRight: 6 }}
                    />
                    <FamilyPreview family={family} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
