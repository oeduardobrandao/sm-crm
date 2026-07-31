// Figma-style compound color picker. Adapted from Kibo UI's `color-picker`
// registry component (https://www.kibo-ui.com/r/color-picker.json — MIT,
// upstream author Hayden Bleasel), which is itself the public/free mirror of
// shadcn.io's paid-tier color-picker. `npx shadcn add` can't be used here:
// components.json's paths predate the monorepo (see DESIGN_SYSTEM.md), so this
// was fetched and copied by hand per house convention.
//
// Deliberate deviations from the upstream file:
//   - Hex-only public contract: `value`/`onChange` speak plain lowercase
//     `#rrggbb` strings, not the upstream `Parameters<typeof Color.rgb>` tuple.
//     This repo's one caller (workspaces.brand_color) is CHECK'd to 6-digit hex.
//   - Alpha is omitted entirely: no `alpha` in context, no ColorPickerAlpha
//     export, no percentage sub-input. There is nothing in this file that CAN
//     produce an 8-digit hex.
//   - Fixed a real bug in the upstream controlled-value sync effect (it called
//     `Color.rgb(value)` on a hex string, which silently produces the wrong
//     color). Re-added here as a ref-guarded effect that only re-syncs when
//     `value` genuinely changes.
//   - The upstream hex field was `readOnly` (output-only; Figma's own picker
//     works the same way, the hex only updates from the saturation/lightness
//     square + hue slider). This repo's users need to paste a client's exact
//     brand hex, so the field is editable here: invalid input reverts to the
//     last committed value on blur instead of propagating.
//   - `ColorPickerSelection`'s crosshair position is now DERIVED from
//     hue/saturation/lightness instead of separately-tracked drag-only state,
//     so an external `value` change (e.g. this tab's seed-once effect) moves
//     the crosshair too, not just a live drag.
//   - `disabled` is threaded through context and applied to the drag surface,
//     the hue slider (native Radix Slider `disabled`), the eyedropper button
//     and the hex input, matching this app's `brandingPending || brandingFailed`
//     gating convention used on every other control in the tab.
//   - Uses this repo's `@radix-ui/react-slider` (scoped package, matching every
//     other Radix import in this codebase) instead of upstream's unified
//     `radix-ui` meta-package, which isn't installed here.
'use client';

import Color from 'color';
import { PipetteIcon } from 'lucide-react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import {
  type ComponentProps,
  createContext,
  type HTMLAttributes,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

type ColorPickerContextValue = {
  hue: number;
  saturation: number;
  lightness: number;
  mode: string;
  disabled?: boolean;
  setHue: (hue: number) => void;
  setSaturation: (saturation: number) => void;
  setLightness: (lightness: number) => void;
  setMode: (mode: string) => void;
};

const ColorPickerContext = createContext<ColorPickerContextValue | undefined>(undefined);

export const useColorPicker = () => {
  const context = useContext(ColorPickerContext);

  if (!context) {
    throw new Error('useColorPicker must be used within a ColorPicker');
  }

  return context;
};

export type ColorPickerProps = Omit<HTMLAttributes<HTMLDivElement>, 'onChange'> & {
  /** Current colour, `#rrggbb` (case-insensitive on the way in). */
  value?: string;
  defaultValue?: string;
  /** Fires with a normalized lowercase `#rrggbb` hex, and only ever that shape. */
  onChange?: (hex: string) => void;
  disabled?: boolean;
};

function safeParse(hex: string | undefined, fallback: string) {
  try {
    return Color(hex ?? fallback);
  } catch {
    return Color(fallback);
  }
}

export const ColorPicker = ({
  value,
  defaultValue = '#000000',
  onChange,
  disabled,
  className,
  ...props
}: ColorPickerProps) => {
  const initial = useMemo(() => safeParse(value, defaultValue), []); // eslint-disable-line react-hooks/exhaustive-deps -- seed once, the sync effect below owns later `value` changes

  const [hue, setHue] = useState(initial.hue() || 0);
  const [saturation, setSaturation] = useState(initial.saturationl());
  const [lightness, setLightness] = useState(initial.lightness());
  const [mode, setMode] = useState('hex');

  // Re-sync from an external `value` change (e.g. HubTab's seed-once effect
  // setting brandColor once the branding query resolves, after this component
  // already mounted with the '#eab308' placeholder). Guarded so the picker's
  // OWN emitted changes (which round-trip back through the parent's `value`
  // prop) don't re-trigger this and fight the user's drag.
  const lastSeenValue = useRef(value);
  useEffect(() => {
    if (value === undefined || value === lastSeenValue.current) return;
    lastSeenValue.current = value;
    if (!HEX_RE.test(value)) return; // not ours to render garbage
    const next = Color(value);
    setHue(next.hue() || 0);
    setSaturation(next.saturationl());
    setLightness(next.lightness());
  }, [value]);

  const lastEmitted = useRef<string | null>(null);
  useEffect(() => {
    const hex = Color.hsl(hue, saturation, lightness).hex().toLowerCase();
    lastSeenValue.current = hex;
    if (hex === lastEmitted.current) return;
    lastEmitted.current = hex;
    onChange?.(hex);
  }, [hue, saturation, lightness, onChange]);

  return (
    <ColorPickerContext.Provider
      value={{
        hue,
        saturation,
        lightness,
        mode,
        disabled,
        setHue,
        setSaturation,
        setLightness,
        setMode,
      }}
    >
      <div
        aria-disabled={disabled}
        className={cn('flex size-full flex-col gap-3', disabled && 'opacity-50', className)}
        {...props}
      />
    </ColorPickerContext.Provider>
  );
};

export type ColorPickerSelectionProps = HTMLAttributes<HTMLDivElement>;

export const ColorPickerSelection = memo(({ className, ...props }: ColorPickerSelectionProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const { hue, saturation, lightness, setSaturation, setLightness, disabled } = useColorPicker();

  // Derived, not separately tracked: the crosshair always reflects the CURRENT
  // saturation/lightness, whether they came from a drag, the hex input, or an
  // external `value` re-seed. Inverts ColorPickerHue/Selection's own forward
  // math (see handlePointerMove below).
  const positionX = Math.min(1, Math.max(0, saturation / 100));
  const topLightness = positionX < 0.01 ? 100 : 50 + 50 * (1 - positionX);
  const positionY = Math.min(1, Math.max(0, 1 - lightness / topLightness));

  const backgroundGradient = useMemo(() => {
    return `linear-gradient(0deg, rgba(0,0,0,1), rgba(0,0,0,0)),
            linear-gradient(90deg, rgba(255,255,255,1), rgba(255,255,255,0)),
            hsl(${hue}, 100%, 50%)`;
  }, [hue]);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      if (!(isDragging && containerRef.current) || disabled) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
      setSaturation(x * 100);
      const topL = x < 0.01 ? 100 : 50 + 50 * (1 - x);
      setLightness(topL * (1 - y));
    },
    [isDragging, disabled, setSaturation, setLightness],
  );

  useEffect(() => {
    const handlePointerUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    }

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isDragging, handlePointerMove]);

  return (
    <div
      aria-disabled={disabled}
      className={cn(
        'relative size-full rounded',
        disabled ? 'cursor-not-allowed' : 'cursor-crosshair',
        className,
      )}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        setIsDragging(true);
        handlePointerMove(e.nativeEvent);
      }}
      ref={containerRef}
      {...props}
      style={{ background: backgroundGradient, ...props.style }}
    >
      <div
        className="-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute h-4 w-4 rounded-full border-2 border-white"
        style={{
          left: `${positionX * 100}%`,
          top: `${positionY * 100}%`,
          boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  );
});

ColorPickerSelection.displayName = 'ColorPickerSelection';

export type ColorPickerHueProps = ComponentProps<typeof SliderPrimitive.Root>;

export const ColorPickerHue = ({ className, ...props }: ColorPickerHueProps) => {
  const { hue, setHue, disabled } = useColorPicker();

  return (
    <SliderPrimitive.Root
      className={cn('relative flex h-4 w-full touch-none', className)}
      disabled={disabled}
      max={360}
      onValueChange={([h]) => setHue(h)}
      step={1}
      value={[hue]}
      {...props}
    >
      <SliderPrimitive.Track className="relative my-0.5 h-3 w-full grow rounded-full bg-[linear-gradient(90deg,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)]">
        <SliderPrimitive.Range className="absolute h-full" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
    </SliderPrimitive.Root>
  );
};

export type ColorPickerEyeDropperProps = ComponentProps<typeof Button>;

export const ColorPickerEyeDropper = ({ className, ...props }: ColorPickerEyeDropperProps) => {
  const { setHue, setSaturation, setLightness, disabled } = useColorPicker();

  const handleEyeDropper = async () => {
    try {
      // @ts-expect-error - EyeDropper API is experimental, not in lib.dom yet
      const eyeDropper = new EyeDropper();
      const result = await eyeDropper.open();
      const color = Color(result.sRGBHex);
      setHue(color.hue() || 0);
      setSaturation(color.saturationl());
      setLightness(color.lightness());
    } catch (error) {
      // Cancelled by the user, or the API isn't supported -- either way, not
      // an error worth surfacing beyond a log.
      console.error('EyeDropper failed:', error);
    }
  };

  return (
    <Button
      className={cn('shrink-0 text-muted-foreground', className)}
      disabled={disabled}
      onClick={handleEyeDropper}
      size="icon"
      type="button"
      variant="outline"
      {...props}
    >
      <PipetteIcon size={16} />
    </Button>
  );
};

export type ColorPickerOutputProps = ComponentProps<typeof SelectTrigger>;

const FORMATS = ['hex', 'rgb', 'css', 'hsl'];

/** Format switcher (hex/rgb/css/hsl). Not rendered by HubTab today (hex-only
 * usage), kept for future callers of this shared primitive. */
export const ColorPickerOutput = ({ className, ...props }: ColorPickerOutputProps) => {
  const { mode, setMode, disabled } = useColorPicker();

  return (
    <Select onValueChange={setMode} value={mode}>
      <SelectTrigger
        className={cn('h-8 w-20 shrink-0 text-xs', className)}
        disabled={disabled}
        {...props}
      >
        <SelectValue placeholder="Modo" />
      </SelectTrigger>
      <SelectContent>
        {FORMATS.map((format) => (
          <SelectItem className="text-xs" key={format} value={format}>
            {format.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export type ColorPickerFormatProps = HTMLAttributes<HTMLDivElement>;

/** Renders (and, in hex mode, edits) the current colour in the picked `mode`.
 * Hex is the only editable mode -- rgb/css/hsl stay read-only outputs, same as
 * upstream, since nothing in this app needs to type an rgb()/hsl() string in. */
export const ColorPickerFormat = ({ className, ...props }: ColorPickerFormatProps) => {
  const { hue, saturation, lightness, mode, setHue, setSaturation, setLightness, disabled } =
    useColorPicker();
  const color = Color.hsl(hue, saturation, lightness);
  const committedHex = color.hex().toLowerCase();

  const [draft, setDraft] = useState(committedHex);
  // While the user is mid-edit, ignore re-renders driven by the picker's own
  // state (drag, eyedropper) so their keystrokes aren't clobbered; once they
  // blur/commit, editing ends and the draft goes back to tracking the picker.
  const editingRef = useRef(false);
  useEffect(() => {
    if (!editingRef.current) setDraft(committedHex);
  }, [committedHex]);

  const commitHex = (raw: string) => {
    editingRef.current = false;
    const trimmed = raw.trim();
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (HEX_RE.test(candidate)) {
      const next = Color(candidate);
      setHue(next.hue() || 0);
      setSaturation(next.saturationl());
      setLightness(next.lightness());
      setDraft(candidate.toLowerCase());
    } else {
      // Invalid: revert to the last valid committed value. Nothing invalid
      // ever reaches setHue/setSaturation/setLightness, so it can never reach
      // the parent's onChange (and therefore never brandColor / the DB).
      setDraft(committedHex);
    }
  };

  if (mode === 'hex') {
    return (
      <div className={cn('flex w-full items-center gap-2', className)} {...props}>
        <Input
          aria-label="Cor em hexadecimal"
          className="h-8 flex-1 rounded-md bg-secondary px-2 font-mono text-xs shadow-none"
          disabled={disabled}
          onBlur={(e) => commitHex(e.target.value)}
          onChange={(e) => {
            editingRef.current = true;
            setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              editingRef.current = false;
              setDraft(committedHex);
              e.currentTarget.blur();
            }
          }}
          type="text"
          value={draft}
        />
      </div>
    );
  }

  if (mode === 'rgb') {
    const rgb = color
      .rgb()
      .array()
      .map((v) => Math.round(v));

    return (
      <div
        className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)}
        {...props}
      >
        {rgb.map((v, index) => (
          <Input
            className={cn(
              'h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none',
              index > 0 && 'rounded-l-none',
            )}
            key={index}
            readOnly
            type="text"
            value={v}
          />
        ))}
      </div>
    );
  }

  if (mode === 'css') {
    const rgb = color
      .rgb()
      .array()
      .map((v) => Math.round(v));

    return (
      <div className={cn('w-full rounded-md shadow-sm', className)} {...props}>
        <Input
          className="h-8 w-full bg-secondary px-2 text-xs shadow-none"
          readOnly
          type="text"
          value={`rgb(${rgb.join(', ')})`}
        />
      </div>
    );
  }

  if (mode === 'hsl') {
    const hsl = color
      .hsl()
      .array()
      .map((v) => Math.round(v));

    return (
      <div
        className={cn('-space-x-px flex items-center rounded-md shadow-sm', className)}
        {...props}
      >
        {hsl.map((v, index) => (
          <Input
            className={cn(
              'h-8 rounded-r-none bg-secondary px-2 text-xs shadow-none',
              index > 0 && 'rounded-l-none',
            )}
            key={index}
            readOnly
            type="text"
            value={v}
          />
        ))}
      </div>
    );
  }

  return null;
};
