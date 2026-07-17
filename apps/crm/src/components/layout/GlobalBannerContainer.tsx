import { useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBanners } from '../../hooks/useBanners';
import { sanitizeUrl } from '../../utils/security';
import type { GlobalBanner } from '../../store/banners';

const TYPE_STYLES: Record<string, { accent: string; bg: string; border: string }> = {
  info: { accent: '#42c8f5', bg: 'rgba(66,200,245,0.18)', border: 'rgba(66,200,245,0.30)' },
  warning: { accent: '#f5a342', bg: 'rgba(245,163,66,0.22)', border: 'rgba(245,163,66,0.35)' },
  critical: { accent: '#f55a42', bg: 'rgba(245,90,66,0.25)', border: 'rgba(245,90,66,0.40)' },
};

function getStyles(banner: GlobalBanner) {
  const base = TYPE_STYLES[banner.type] || TYPE_STYLES.info;
  if (!banner.custom_color) return base;
  return {
    accent: banner.custom_color,
    bg: `${banner.custom_color}14`,
    border: `${banner.custom_color}33`,
  };
}

function contentHasLinks(content: string): boolean {
  return /\[.*?\]\(.*?\)/.test(content) || /<a\s/i.test(content);
}

interface GlobalBannerContainerProps {
  /**
   * Rendered above the mapped global banners — a billing failure outranks an announcement.
   * This component is the single owner of the fixed banner stack and the --banner-height
   * variable it drives, so anything that needs to live in that stack (e.g. DunningBanner)
   * is passed in here rather than mounted as a sibling.
   */
  children?: ReactNode;
}

export default function GlobalBannerContainer({ children }: GlobalBannerContainerProps) {
  const { banners, dismiss } = useBanners();
  const containerRef = useRef<HTMLDivElement>(null);

  // Measured via ResizeObserver (not a `banners.length` dep): DunningBanner resolves its own
  // TanStack Query independently and can appear without this component re-rendering, so an
  // effect keyed on banner state alone would leave --banner-height stale.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const setHeight = () => {
      document.documentElement.style.setProperty('--banner-height', `${el.offsetHeight}px`);
    };

    setHeight();

    if (typeof ResizeObserver === 'undefined') {
      // jsdom (test environment) has no ResizeObserver — fall back to a one-time measurement.
      return () => {
        document.documentElement.style.setProperty('--banner-height', '0px');
      };
    }

    const observer = new ResizeObserver(setHeight);
    observer.observe(el);

    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty('--banner-height', '0px');
    };
  }, []);

  return (
    <div ref={containerRef} className="banner-container">
      {children}
      {banners.map((b) => {
        const styles = getStyles(b);
        const hasInlineLinks = contentHasLinks(b.content);
        const useLink = b.link && !hasInlineLinks;

        const inner = (
          <>
            <div
              className="banner-content"
              style={b.type === 'critical' ? { color: styles.accent } : undefined}
            >
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <span>{children}</span>,
                  a: ({ href, children }) => (
                    <a
                      href={sanitizeUrl(href || '')}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: styles.accent, textDecoration: 'underline' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {children}
                    </a>
                  ),
                }}
              >
                {b.content}
              </ReactMarkdown>
            </div>
            {b.dismissible && (
              <button
                className="banner-dismiss"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  dismiss(b.id);
                }}
                aria-label="Dismiss banner"
              >
                ×
              </button>
            )}
          </>
        );

        return useLink ? (
          <a
            key={b.id}
            href={sanitizeUrl(b.link!)}
            target="_blank"
            rel="noopener noreferrer"
            className="banner-bar"
            style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}
          >
            {inner}
          </a>
        ) : (
          <div
            key={b.id}
            className="banner-bar"
            style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}
          >
            {inner}
          </div>
        );
      })}
    </div>
  );
}
