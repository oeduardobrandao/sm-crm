// T3.5 ColorPicker (docs/estudio-design.md §6.1 shared/, plan §4): the real color control that
// replaces ContextualToolbar's stopgap hex inputs. Native <input type="color"> + a validated hex
// field (accepts the schema's full #rrggbb[aa] shape) + brand swatches pinned first + recents.
// Deliberately importable from OUTSIDE the estudio page too — HubTab's BrandEditor (T3.7) uses
// this exact component for hub_brand colors, so brand editing and canvas editing share one
// picker.
//
// `value` tolerance: hub_brand colors are legacy FREE TEXT (users may have stored "azul" or
// "rgb(0,0,0)"), so a non-hex `value` must not crash the control — the hex field shows the raw
// string and the native input falls back to black; nothing is dispatched until a VALID hex is
// committed. `onChange` is therefore guaranteed to only ever emit schema-valid hex.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Schema-shaped hex (#rrggbb[aa]) — inlined from the retired design-doc schema when the v1
// editor was removed; this picker is now the only consumer.
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const HEX_6_RE = /^#[0-9a-fA-F]{6}$/;

export const RECENT_COLORS_KEY = 'estudio-recent-colors';
export const RECENT_COLORS_MAX = 8;

/** Most-recent-first list of hexes the user committed via ANY ColorPicker instance. Storage
 * errors (private mode, quota) are swallowed — recents are a convenience, never load-bearing. */
export function readRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_COLORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === 'string' && HEX_COLOR_RE.test(c));
  } catch {
    return [];
  }
}

export function pushRecentColor(hex: string): string[] {
  const next = [hex, ...readRecentColors().filter((c) => c.toLowerCase() !== hex.toLowerCase())];
  const capped = next.slice(0, RECENT_COLORS_MAX);
  try {
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(capped));
  } catch {
    // best-effort — see readRecentColors
  }
  return capped;
}

/** Normalizes user-ish color text to schema hex when possible: trims, tolerates a missing '#'.
 * Returns null for anything that isn't (or can't become) #rrggbb[aa]. */
export function normalizeHexInput(raw: string): string | null {
  const trimmed = raw.trim();
  const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  return HEX_COLOR_RE.test(candidate) ? candidate.toLowerCase() : null;
}

export interface ColorPickerProps {
  /** Current color — ideally #rrggbb[aa], but tolerated as arbitrary text (see header). */
  value: string;
  /** Called ONLY with schema-valid hex. Native-picker drags fire this LIVE, once per tick, each
   * carrying the same per-drag `coalesceKey` — undo-aware callers (the editor) collapse the burst
   * into one undo entry; callers without an undo stack (BrandEditor) just ignore the 2nd arg. */
  onChange: (hex: string, opts?: { coalesceKey?: string }) => void;
  /** Pinned "Marca" swatches (already-validated hex, invalid entries are the caller's to drop). */
  brandColors?: string[];
  /** Accept the 8-digit #rrggbbaa form in the hex field (default true — the schema allows it). */
  allowAlpha?: boolean;
  label?: string;
  disabled?: boolean;
}

// Distinct per drag session ACROSS all picker instances, so two separate drags on the same
// control never share a coalesce key (each drag = its own undo entry).
let colorDragSessionCounter = 0;

function Swatch({
  hex,
  onPick,
  title,
}: {
  hex: string;
  onPick: (hex: string) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title ?? hex}
      aria-label={title ?? hex}
      onClick={() => onPick(hex)}
      style={{
        width: 22,
        height: 22,
        borderRadius: 6,
        border: '1px solid var(--border-color)',
        background: hex,
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}

function SwatchGroup({
  label,
  colors,
  onPick,
}: {
  label: string;
  colors: string[];
  onPick: (hex: string) => void;
}) {
  if (colors.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      <span
        style={{
          fontSize: '0.6rem',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--text-muted)',
        }}
      >
        {label}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        {colors.map((hex) => (
          <Swatch key={hex} hex={hex} onPick={onPick} />
        ))}
      </div>
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
  brandColors = [],
  allowAlpha = true,
  label,
  disabled,
}: ColorPickerProps) {
  const { t } = useTranslation('estudio');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [recents, setRecents] = useState<string[]>([]);

  // Draft follows external changes (undo/redo, other pickers) — same discipline as
  // ContextualToolbar's CommitInput.
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Recents are read lazily on open so pickers see commits made by OTHER instances.
  useEffect(() => {
    if (open) setRecents(readRecentColors());
  }, [open]);

  const validRe = allowAlpha ? HEX_COLOR_RE : HEX_6_RE;

  // The native input commits LIVE, per tick. The original design buffered picks and committed
  // once on popover close — but on macOS the OS color panel is a separate window, and anything
  // that closes the popover before/during the pick (interact-outside, focus loss) unmounted this
  // component with the pick still buffered: "picking a new color doesn't work". Live commits
  // make the canvas follow the drag (Figma behavior) and can't be lost to a close. The undo
  // flood is handled by `coalesceKey`: every tick of one drag shares a key, so undo-aware
  // callers store the whole drag as ONE entry.
  const dragSessionRef = useRef<string | null>(null);
  // Last live-committed hex — pushed to recents ONCE when the popover closes (recents per tick
  // would churn the list with every intermediate drag color).
  const lastNativeHexRef = useRef<string | null>(null);

  const commitLive = (raw: string) => {
    const normalized = normalizeHexInput(raw);
    if (!normalized || !validRe.test(normalized)) return;
    dragSessionRef.current ??= `colorpicker:${++colorDragSessionCounter}`;
    lastNativeHexRef.current = normalized;
    onChange(normalized, { coalesceKey: dragSessionRef.current });
  };

  const commit = (raw: string) => {
    const normalized = normalizeHexInput(raw);
    if (!normalized || !validRe.test(normalized)) return;
    // A discrete commit (hex field, swatch) ends any in-progress native-drag session — a later
    // drag must open its own undo entry, not coalesce into the pre-commit one.
    dragSessionRef.current = null;
    lastNativeHexRef.current = null;
    setRecents(pushRecentColor(normalized));
    onChange(normalized);
  };

  // The native input only speaks 6-digit hex: feed it the rgb part of the current value, and
  // when it changes, re-attach the current alpha suffix so alpha survives an rgb-only edit.
  const valueIsHex = HEX_COLOR_RE.test(value);
  const nativeValue = valueIsHex ? value.slice(0, 7).toLowerCase() : '#000000';
  const alphaSuffix = allowAlpha && valueIsHex && value.length === 9 ? value.slice(7) : '';

  const hexFieldId = useRef(`estudio-color-${Math.random().toString(36).slice(2, 8)}`).current;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          // The picks themselves already committed live — closing only finalizes bookkeeping:
          // the drag's END color joins recents, and the session ends so the next drag gets its
          // own undo entry.
          if (lastNativeHexRef.current) setRecents(pushRecentColor(lastNativeHexRef.current));
          lastNativeHexRef.current = null;
          dragSessionRef.current = null;
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          data-testid="estudio-color-trigger"
          aria-label={label ?? t('colorPicker.open')}
          title={label ?? t('colorPicker.open')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.35rem 0.6rem',
            borderRadius: 8,
            border: '1px solid var(--border-color)',
            background: 'var(--surface-main)',
            color: 'var(--text-main)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <span
            aria-hidden
            style={{
              width: 16,
              height: 16,
              borderRadius: 4,
              border: '1px solid var(--border-color)',
              background: valueIsHex ? value : 'var(--surface-darker)',
              flexShrink: 0,
            }}
          />
          {valueIsHex ? value.toLowerCase() : value || t('colorPicker.empty')}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-3 flex flex-col gap-3" align="start">
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="color"
            data-testid="estudio-color-native"
            aria-label={t('colorPicker.native')}
            value={nativeValue}
            onChange={(e) => {
              commitLive(`${e.target.value}${alphaSuffix}`);
            }}
            style={{
              width: 36,
              height: 32,
              padding: 0,
              border: '1px solid var(--border-color)',
              borderRadius: 8,
              background: 'transparent',
              cursor: 'pointer',
            }}
          />
          <input
            id={hexFieldId}
            data-testid="estudio-color-hex"
            aria-label={t('colorPicker.hex')}
            value={draft}
            placeholder={allowAlpha ? '#rrggbb[aa]' : '#rrggbb'}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== value) commit(draft);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(value);
                e.currentTarget.blur();
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: 'var(--font-mono)',
              padding: '0.35rem 0.5rem',
              borderRadius: 8,
              border: '1px solid var(--border-color)',
              background: 'var(--surface-main)',
              color: 'var(--text-main)',
              fontSize: '0.8rem',
            }}
          />
        </div>

        <SwatchGroup label={t('colorPicker.brand')} colors={brandColors} onPick={commit} />
        <SwatchGroup label={t('colorPicker.recents')} colors={recents} onPick={commit} />
      </PopoverContent>
    </Popover>
  );
}
