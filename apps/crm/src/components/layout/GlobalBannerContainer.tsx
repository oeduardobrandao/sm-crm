import { useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useBanners } from '../../hooks/useBanners';
import { sanitizeUrl } from '../../utils/security';
import type { GlobalBanner } from '../../store';

const TYPE_STYLES: Record<string, { accent: string; bg: string; border: string }> = {
  info: { accent: '#42c8f5', bg: 'rgba(66,200,245,0.08)', border: 'rgba(66,200,245,0.15)' },
  warning: { accent: '#f5a342', bg: 'rgba(245,163,66,0.10)', border: 'rgba(245,163,66,0.20)' },
  critical: { accent: '#f55a42', bg: 'rgba(245,90,66,0.12)', border: 'rgba(245,90,66,0.25)' },
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

export default function GlobalBannerContainer() {
  const { banners, dismiss } = useBanners();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const height = containerRef.current?.offsetHeight || 0;
    document.documentElement.style.setProperty('--banner-height', `${height}px`);
    return () => {
      document.documentElement.style.setProperty('--banner-height', '0px');
    };
  }, [banners.length]);

  if (banners.length === 0) return null;

  return (
    <div ref={containerRef} className="banner-container">
      {banners.map((b) => {
        const styles = getStyles(b);
        const hasInlineLinks = contentHasLinks(b.content);
        const useLink = b.link && !hasInlineLinks;

        const inner = (
          <>
            <div className="banner-content" style={b.type === 'critical' ? { color: styles.accent } : undefined}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}
                components={{
                  p: ({ children }) => <span>{children}</span>,
                  a: ({ href, children }) => (
                    <a href={sanitizeUrl(href || '')} target="_blank" rel="noopener noreferrer"
                      style={{ color: styles.accent, textDecoration: 'underline' }}
                      onClick={(e) => e.stopPropagation()}>
                      {children}
                    </a>
                  ),
                }}>
                {b.content}
              </ReactMarkdown>
            </div>
            {b.dismissible && (
              <button className="banner-dismiss" onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(b.id); }}
                aria-label="Dismiss banner">
                ×
              </button>
            )}
          </>
        );

        return useLink ? (
          <a key={b.id} href={sanitizeUrl(b.link!)} target="_blank" rel="noopener noreferrer"
            className="banner-bar" style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}>
            {inner}
          </a>
        ) : (
          <div key={b.id} className="banner-bar"
            style={{ background: styles.bg, borderBottom: `1px solid ${styles.border}` }}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
