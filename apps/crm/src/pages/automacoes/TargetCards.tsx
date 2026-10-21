import { Check, ExternalLink, Instagram } from 'lucide-react';
import { sanitizeUrl } from '@/utils/security';

/** One tile of the "Em produção" grid. Shared by the live list and by the pinned
 * card that stands in for a target which has dropped out of that list, so the two
 * are visually identical by construction. */
export function ProductionCard({
  titulo,
  tipoLabel,
  imageUrl,
  selected,
  onSelect,
}: {
  titulo: string;
  /** Omitted for the pinned card: the seed carries a titulo and nothing else. */
  tipoLabel: string | null;
  imageUrl: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      // The cover is decorative (alt=""), so the titulo has to carry the
      // accessible name either way.
      aria-label={titulo}
      style={{
        position: 'relative',
        aspectRatio: '1',
        borderRadius: 8,
        overflow: 'hidden',
        border: selected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
        padding: 0,
        cursor: 'pointer',
        background: 'var(--surface-1)',
      }}
    >
      {imageUrl ? (
        <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span
          className="flex flex-col justify-center h-full"
          style={{ padding: '0.375rem', gap: 2, textAlign: 'left', overflow: 'hidden' }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              lineHeight: 1.2,
              color: 'var(--text-main)',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {titulo}
          </span>
          {tipoLabel && (
            <span style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>{tipoLabel}</span>
          )}
        </span>
      )}
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            background: 'var(--primary-color)',
            borderRadius: '50%',
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Check className="h-2.5 w-2.5" style={{ color: '#fff' }} />
        </span>
      )}
    </button>
  );
}

/** One tile of the "Publicados" grid. Shared by the synced feed, by the pinned
 * card that stands in for a target the daily `instagram_posts` sync has not
 * landed yet, and by the live Graph API selector (`LiveMediaPicker`) used to
 * re-mirror an orphaned target -- so all three are visually identical by
 * construction. */
export function PublishedCard({
  caption,
  thumbnailUrl,
  permalink,
  permalinkLabel,
  selected,
  onSelect,
}: {
  /** Accessible name. Null for the synced tiles, whose thumbnail is decorative
   * and which are identified by position; the pinned card and the live
   * selector's tiles name themselves. */
  caption: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  permalinkLabel: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <span style={{ position: 'relative', display: 'block', aspectRatio: '1' }}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={caption ?? undefined}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
          overflow: 'hidden',
          border: selected ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
          padding: 0,
          cursor: 'pointer',
          background: 'var(--surface-1)',
        }}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : caption ? (
          <span
            className="flex flex-col justify-center h-full"
            style={{ padding: '0.375rem', textAlign: 'left', overflow: 'hidden' }}
          >
            <span
              style={{
                fontSize: '0.7rem',
                lineHeight: 1.2,
                color: 'var(--text-main)',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {caption}
            </span>
          </span>
        ) : (
          <span className="flex items-center justify-center h-full">
            <Instagram className="h-4 w-4" style={{ color: 'var(--text-muted)' }} />
          </span>
        )}
      </button>
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: 3,
            right: 3,
            background: 'var(--primary-color)',
            borderRadius: '50%',
            width: 16,
            height: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <Check className="h-2.5 w-2.5" style={{ color: '#fff' }} />
        </span>
      )}
      {/* Sibling of the button, never nested inside it: an anchor within a
          button is invalid markup and swallows the click. */}
      {permalink && (
        <a
          href={sanitizeUrl(permalink)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={permalinkLabel}
          style={{
            position: 'absolute',
            left: 3,
            bottom: 3,
            display: 'flex',
            padding: 2,
            borderRadius: 4,
            background: 'var(--surface-main)',
            color: 'var(--text-muted)',
          }}
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  );
}
