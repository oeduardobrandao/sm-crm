/**
 * Compatibility shim for legacy vanilla TS components that still import from router.
 */
import { toast } from 'sonner';

export function showToast(msg: string, type: 'success' | 'error' | 'info' = 'success'): void {
  if (type === 'error') toast.error(msg);
  else if (type === 'info') toast.info(msg);
  else toast.success(msg);
}

export function openModal(_title: string, _html?: string, _onConfirm?: () => void, _opts?: string | Record<string, unknown>): void {
  // no-op shim — old vanilla modal system replaced by antd Modal
}

export function closeModal(_id?: string): void {
  // no-op shim
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
