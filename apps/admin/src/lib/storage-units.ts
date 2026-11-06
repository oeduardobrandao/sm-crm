import { useState } from 'react';

// Storage quotas are stored in bytes; the admin edits them in GB. Binary GB (1024³), the same
// unit formatBytes/formatStorage display, so 10737418240 reads as "10".
export const BYTES_PER_GB = 1024 ** 3;

/** Bytes → the GB text an input shows. Null (unlimited) is empty. */
export function bytesToGbInput(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  return String(Number((bytes / BYTES_PER_GB).toFixed(4)));
}

/** GB text → whole bytes. Empty or invalid is null (unlimited), like the other limit fields. */
export function gbInputToBytes(raw: string): number | null {
  const t = raw.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * BYTES_PER_GB);
}

/**
 * The text of a GB input whose source of truth is a byte count. Keeps what the user typed
 * ("0.1" would not survive a bytes round-trip) while it still means the same bytes; once the
 * bytes change from outside (form reset, another plan), it shows them converted.
 */
export function useGbText(bytes: number | null | undefined) {
  const [text, setText] = useState('');
  const value = gbInputToBytes(text) === (bytes ?? null) ? text : bytesToGbInput(bytes);
  return [value, setText] as const;
}
