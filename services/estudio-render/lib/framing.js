// Binary frame for endpoints that carry JSON + .fig bytes in one body (Vercel's
// ~4.5MB request limit makes base64-in-JSON a bad fit for image-bearing docs).
// Layout: 'MDF1' magic (4) | u32be json length | utf-8 json | raw fig bytes.
// Used by POST /api/mutate in both directions; the Deno caller mirrors this.

const MAGIC = new TextEncoder().encode('MDF1');

export function encodeFrame(json, bytes) {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const out = new Uint8Array(8 + jsonBytes.length + bytes.length);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(4, jsonBytes.length, false);
  out.set(jsonBytes, 8);
  out.set(bytes, 8 + jsonBytes.length);
  return out;
}

/** Returns {json, bytes} or throws Error('bad_frame'). */
export function decodeFrame(u8) {
  if (u8.length < 8 || u8[0] !== 77 || u8[1] !== 68 || u8[2] !== 70 || u8[3] !== 49) {
    throw new Error('bad_frame');
  }
  const jsonLen = new DataView(u8.buffer, u8.byteOffset).getUint32(4, false);
  if (8 + jsonLen > u8.length) throw new Error('bad_frame');
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jsonLen)));
  } catch {
    throw new Error('bad_frame');
  }
  return { json, bytes: u8.subarray(8 + jsonLen) };
}
