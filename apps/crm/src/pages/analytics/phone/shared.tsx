import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PickerSheet } from '@/components/mobile/PickerSheet';
import type { CheckListOption, CheckListValue } from '@/components/mobile/CheckList';
import { sanitizeUrl } from '../../../utils/security';
import './analyticsPhone.css';

/** pt-BR thousands ("15.320"). */
export function fmtNumber(n: number | null | undefined): string {
  return (n || 0).toLocaleString('pt-BR');
}

/** Label of an Instagram media type, as the analytics pages write it. */
export function mediaTypeLabel(type: string): string {
  switch (type) {
    case 'VIDEO':
      return 'Reels';
    case 'CAROUSEL_ALBUM':
      return 'Carrossel';
    case 'IMAGE':
      return 'Imagem';
    case 'STORY':
      return 'Story';
    default:
      return type;
  }
}

/**
 * A pill that shows "Label: value" and opens a checkmark list (FAnalytics "Cliente: Todos",
 * "Período: 28 dias"). It opens a sheet, so it is a plain button with `aria-haspopup`,
 * not a pressed toggle chip.
 */
export function PickerChip<T extends CheckListValue>({
  label,
  valueLabel,
  options,
  value,
  onChange,
  emptyOption,
  searchable,
  sheetTitle,
}: {
  label: string;
  valueLabel: string;
  options: CheckListOption<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  emptyOption?: { label: ReactNode };
  searchable?: boolean;
  sheetTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="phone-an-chip"
        aria-haspopup="dialog"
        aria-label={`${label}: ${valueLabel}`}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <span>{label}:</span>
        <span className="phone-an-chip__value">{valueLabel}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {mounted && (
        <PickerSheet<T>
          open={open}
          onOpenChange={setOpen}
          title={sheetTitle ?? label}
          options={options}
          value={value}
          onChange={onChange}
          emptyOption={emptyOption}
          searchable={searchable}
          returnFocusRef={ref}
        />
      )}
    </>
  );
}

/** Section title with an optional trailing control (sort chip, "Ver mais"). */
export function SectionHead({
  title,
  id,
  trailing,
  large,
}: {
  title: ReactNode;
  id?: string;
  trailing?: ReactNode;
  /** 20px bold title (FAnalytics "Melhores posts") instead of the small caps header. */
  large?: boolean;
}) {
  return (
    <div className={cn('phone-an-section-head', large && 'phone-an-section-head--large')}>
      <h2 id={id} className="phone-an-section-head__title">
        {title}
      </h2>
      {trailing}
    </div>
  );
}

/** Round avatar: a safe https photo, else the coloured initials. */
export function Avatar({
  src,
  initials,
  color,
  large,
}: {
  src?: string | null;
  initials: string;
  color?: string | null;
  large?: boolean;
}) {
  const safe = src && src.startsWith('https://') ? src : null;
  const className = cn('phone-an-avatar', large && 'phone-an-avatar--lg');
  if (safe) return <img src={safe} alt="" className={className} aria-hidden="true" />;
  return (
    <span className={className} style={{ background: color || undefined }} aria-hidden="true">
      {initials}
    </span>
  );
}

const MEDIA_ACCENT: Record<string, string> = {
  VIDEO: '#8b5cf6',
  CAROUSEL_ALBUM: '#10b981',
  IMAGE: '#3b82f6',
};

/** 40px post thumbnail; the media type's colour when there is no image. */
export function PostThumb({
  url,
  mediaType,
  className,
}: {
  url?: string | null;
  mediaType: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const accent = MEDIA_ACCENT[mediaType] ?? '#64748b';
  return (
    <span
      className={cn('phone-an-thumb', className)}
      style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
      aria-hidden="true"
    >
      {url && !failed && (
        <img src={sanitizeUrl(url)} alt="" loading="lazy" onError={() => setFailed(true)} />
      )}
    </span>
  );
}

/**
 * The AI text fields arrive as prose or as "•"-separated items; split them the way the
 * desktop BulletText does, so both read the same.
 */
export function BulletTextPhone({ text }: { text: unknown }) {
  if (!text || typeof text !== 'string') return <p>{String(text ?? '')}</p>;
  const lines = text
    .split(/\n|[,.]?\s*•\s*/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length <= 1) return <p>{text}</p>;
  return (
    <ul>
      {lines.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </ul>
  );
}

/** A text block as one row of a `GroupedList`. */
export function TextCell({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <li className="phone-cell">
      <div className="phone-an-text">
        {title && <span className="phone-an-text__title">{title}</span>}
        {children}
      </div>
    </li>
  );
}

/** A small value tile (post detail, story KPIs). `value` null reads "Sem dado". */
export function ValueTile({ label, value }: { label: string; value: ReactNode | null }) {
  const empty = value === null;
  return (
    <div className="phone-an-tile">
      <span className={cn('phone-an-tile__value', empty && 'phone-an-tile__value--empty')}>
        {empty ? 'Sem dado' : value}
      </span>
      <span className="phone-an-tile__label">{label}</span>
    </div>
  );
}
