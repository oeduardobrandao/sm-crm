// Shared request plumbing for the service endpoints: constant-time bearer check
// against RENDER_SERVICE_SECRET (the service's ONLY secret) and a size-capped
// body reader.
import { timingSafeEqual } from 'node:crypto';

export const MAX_BLOB_BYTES = 10 * 1024 * 1024;

export function authorized(req) {
  const secret = process.env.RENDER_SERVICE_SECRET;
  if (!secret) return false;
  const header = req.headers.authorization ?? '';
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Reads the whole body; null when it exceeds MAX_BLOB_BYTES. */
export async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BLOB_BYTES) return null;
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}
