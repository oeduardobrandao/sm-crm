import { describe, expect, it, vi } from 'vitest';
import { handleTranscribe, type Env } from './index';

const SECRET = 'test-secret';

function makeEnv(opts: { object?: Uint8Array | null; run?: (model: string, input: unknown) => Promise<unknown> } = {}): Env {
  const bytes = opts.object === undefined ? new Uint8Array([1, 2, 3]) : opts.object;
  return {
    TRANSCRIBE_SECRET: SECRET,
    MEDIA_BUCKET: {
      get: vi.fn(async () =>
        bytes
          ? { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(0) }
          : null,
      ),
    } as unknown as Env['MEDIA_BUCKET'],
    AI: { run: vi.fn(opts.run ?? (async () => ({ text: ' olá mundo ', transcription_info: { duration: 2.5 } }))) } as unknown as Env['AI'],
  };
}

function req(body: unknown, secret = SECRET, method = 'POST') {
  return new Request('https://transcribe.example/', {
    method,
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  });
}

const KEY = 'briefing-audio/conta/q/a.webm';

describe('transcribe worker', () => {
  it('401 on wrong or missing secret', async () => {
    expect((await handleTranscribe(req({ key: KEY }, 'nope'), makeEnv())).status).toBe(401);
    const noAuth = new Request('https://t/', { method: 'POST', body: '{}' });
    expect((await handleTranscribe(noAuth, makeEnv())).status).toBe(401);
  });

  it('405 on GET, 400 on bad key', async () => {
    expect((await handleTranscribe(req({}, SECRET, 'GET'), makeEnv())).status).toBe(405);
    expect((await handleTranscribe(req({ key: 'contas/x/files/a.webm' }), makeEnv())).status).toBe(400);
    expect((await handleTranscribe(req({ key: 'briefing-audio/../x' }), makeEnv())).status).toBe(400);
  });

  it('404 when the object is missing, 413 when too large', async () => {
    expect((await handleTranscribe(req({ key: KEY }), makeEnv({ object: null }))).status).toBe(404);
    const big = makeEnv();
    (big.MEDIA_BUCKET.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ size: 16 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) });
    expect((await handleTranscribe(req({ key: KEY }), big)).status).toBe(413);
  });

  it('200 with trimmed text and duration, calling whisper turbo in pt', async () => {
    const env = makeEnv();
    const res = await handleTranscribe(req({ key: KEY }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'olá mundo', duration: 2.5 });
    const [model, input] = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, unknown>];
    expect(model).toBe('@cf/openai/whisper-large-v3-turbo');
    expect(input.language).toBe('pt');
    expect(input.task).toBe('transcribe');
    expect(input.audio).toBe(btoa(String.fromCharCode(1, 2, 3)));
  });

  it('502 when the model throws', async () => {
    const env = makeEnv({ run: async () => { throw new Error('model down'); } });
    const res = await handleTranscribe(req({ key: KEY }), env);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'transcription failed' });
  });
});
