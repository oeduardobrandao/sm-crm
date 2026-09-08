interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  AI: AiBinding;
  MEDIA_BUCKET: R2Bucket;
  TRANSCRIBE_SECRET: string;
}

const MODEL = '@cf/openai/whisper-large-v3-turbo';
const KEY_PREFIX = 'briefing-audio/';
const MAX_BYTES = 15 * 1024 * 1024;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const auth = request.headers.get('Authorization') ?? '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!env.TRANSCRIBE_SECRET || !presented || !timingSafeEqual(presented, env.TRANSCRIBE_SECRET)) {
    return json({ error: 'unauthorized' }, 401);
  }

  let key = '';
  try {
    const body = (await request.json()) as { key?: unknown };
    key = typeof body.key === 'string' ? body.key : '';
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  if (!key.startsWith(KEY_PREFIX) || key.includes('..')) return json({ error: 'invalid key' }, 400);

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return json({ error: 'not found' }, 404);
  if (object.size > MAX_BYTES) return json({ error: 'too large' }, 413);

  const bytes = new Uint8Array(await object.arrayBuffer());
  try {
    const out = (await env.AI.run(MODEL, {
      audio: toBase64(bytes),
      task: 'transcribe',
      language: 'pt',
    })) as { text?: unknown; transcription_info?: { duration?: unknown } };
    const text = typeof out.text === 'string' ? out.text.trim() : '';
    const duration =
      typeof out.transcription_info?.duration === 'number' ? out.transcription_info.duration : null;
    return json({ text, duration });
  } catch (e) {
    console.error('transcribe: model error', (e as Error).message);
    return json({ error: 'transcription failed' }, 502);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleTranscribe(request, env);
  },
};
