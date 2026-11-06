import { useEffect, useRef } from 'react';

const COUNTED_HOST = 'www.mesaas.com.br';

/** True when this page load may count as a reader view. Browser reads: effect-only. */
function shouldCount(): boolean {
  if (window.location.hostname !== COUNTED_HOST) return false;
  if (new URLSearchParams(window.location.search).get('ref') === 'admin') return false;
  if (navigator.webdriver) return false;
  return true;
}

function sendView(slug: string): void {
  try {
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/blog-view`, {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }).catch(() => {});
  } catch {
    // Fire-and-forget: a failed ping never affects reading.
  }
}

/** Pings the anonymous view counter once per slug per mount, only for real visits on the
 * production host (not staging, previews, the Admin's own opens or automated browsers), and
 * only once the tab is visible (prerender/background loads are not reads). The page is
 * prerendered, so nothing here may touch window/document outside the effect. */
export function useRecordBlogView(slug: string | null): void {
  const sent = useRef(new Set<string>());

  useEffect(() => {
    if (!slug || sent.current.has(slug) || !shouldCount()) return;

    const send = () => {
      if (sent.current.has(slug)) return;
      sent.current.add(slug);
      sendView(slug);
    };

    if (document.visibilityState === 'visible') {
      send();
      return;
    }
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      send();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [slug]);
}
