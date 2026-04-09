/**
 * Compatibility shim for legacy vanilla TS components that still import from router.
 */
import { toast } from 'sonner';

export function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success'): void {
  if (type === 'error') toast.error(msg);
  else if (type === 'info') toast.info(msg);
  else toast.success(msg);
}

export function openModal(title: string, _html?: string, onConfirm?: () => void, _opts?: string | Record<string, unknown>): void {
  if (window.confirm(title)) {
    onConfirm?.();
  }
}

export function closeModal(_id?: string): void {
  // no-op — confirmation already handled by openModal
}

export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function sanitizeUrl(url: string | undefined | null): string {
  if (!url) return '#';
  const trimmed = url.trim().toLowerCase();
  if (trimmed.startsWith('javascript:') || trimmed.startsWith('data:')) return '#';
  return url;
}
