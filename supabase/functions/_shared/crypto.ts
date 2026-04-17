/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses XOR accumulator so execution time is independent of where strings differ.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);

  if (aBuf.length !== bBuf.length) {
    // Compare against self to burn the same amount of time,
    // then return false.
    let _ = 0;
    for (let i = 0; i < aBuf.length; i++) {
      _ |= aBuf[i] ^ aBuf[i];
    }
    return false;
  }

  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}
