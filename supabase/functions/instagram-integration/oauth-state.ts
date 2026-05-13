function getTokenEncryptionKey(): string {
  const key = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY required");
  return key;
}

async function getHmacKey(): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(getTokenEncryptionKey().slice(0, 32).padEnd(32, '0')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export function toUrlSafeBase64(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromUrlSafeBase64(b64: string): string {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return pad ? padded + '='.repeat(4 - pad) : padded;
}

// deno-lint-ignore no-explicit-any
export async function createSignedState(clientId: string, userId: string, contaId: string, serviceClient: any): Promise<string> {
  await serviceClient.from('oauth_states').delete().lt('expires_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const payload = JSON.stringify({ clientId, userId, contaId, nonce: crypto.randomUUID(), iat: Date.now() });
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const payloadB64 = toUrlSafeBase64(btoa(payload));
  const sigB64 = toUrlSafeBase64(btoa(String.fromCharCode(...new Uint8Array(sigBuf))));
  const parsed = JSON.parse(payload);
  await serviceClient.from('oauth_states').insert({
    nonce: parsed.nonce,
    client_id: parseInt(clientId, 10),
    conta_id: contaId,
    initiated_by: userId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  return payloadB64 + '.' + sigB64;
}

export async function verifySignedState(state: string): Promise<{ clientId: string; userId: string; contaId: string; nonce: string }> {
  const s = decodeURIComponent(state);
  const dotIdx = s.indexOf('.');
  if (dotIdx === -1) throw new Error('Invalid state format');
  const payloadB64 = s.slice(0, dotIdx);
  const sigB64 = s.slice(dotIdx + 1);
  const payload = atob(fromUrlSafeBase64(payloadB64));
  const key = await getHmacKey();
  const enc = new TextEncoder();
  const sigBytes = Uint8Array.from(atob(fromUrlSafeBase64(sigB64)), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
  if (!valid) throw new Error('State signature invalid');
  const parsed = JSON.parse(payload);
  if (Date.now() - parsed.iat > 10 * 60 * 1000) throw new Error('State expired');
  return { clientId: parsed.clientId, userId: parsed.userId, contaId: parsed.contaId, nonce: parsed.nonce };
}
