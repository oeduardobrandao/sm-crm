import { sanitizeUrl } from '@/utils/security';

/** Instagram handles: letters, digits, `.` and `_`, at most 30 chars. Anything
 * else (a stale or odd snapshot) renders as plain text, never a link. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export function instagramProfileUrl(username: string | null): string | null {
  if (!username || !HANDLE.test(username)) return null;
  const url = sanitizeUrl(`https://instagram.com/${encodeURIComponent(username)}`);
  return url === '#' ? null : url;
}
