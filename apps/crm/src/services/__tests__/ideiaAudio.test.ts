import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'jwt' } } })) },
  },
}));

import {
  deleteIdeiaAudio,
  fetchIdeiaAudio,
  retryIdeiaTranscription,
  uploadIdeiaAudio,
} from '../ideiaAudio';

class FakeXHR {
  static last: FakeXHR | null = null;
  headers: Record<string, string> = {};
  url = '';
  status = 200;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  open(_m: string, url: string) {
    this.url = url;
    FakeXHR.last = this;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send() {
    queueMicrotask(() => this.onload?.());
  }
}

const fetchMock = vi.fn();

describe('ideiaAudio service (crm)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
  });

  it('fetches the audio view with the user JWT', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ audio: null, transcript: 'T' })));
    const v = await fetchIdeiaAudio('i1');
    expect(v.transcript).toBe('T');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/ideia-media-manage/audio?ideia_id=i1');
    expect(init.headers.Authorization).toBe('Bearer jwt');
  });

  it('presigns, PUTs and finalizes with phases', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            upload_url: 'https://r2/put',
            r2_key: 'ideia-audio/c/i/x.webm',
            mime_type: 'audio/webm',
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, transcript: 'oi', audio: null })),
      );
    const phases: string[] = [];
    const res = await uploadIdeiaAudio({
      ideiaId: 'i1',
      blob: new Blob(['abc'], { type: 'audio/webm;codecs=opus' }),
      mime: 'audio/webm;codecs=opus',
      durationSeconds: 3.2,
      onPhase: (p) => phases.push(p),
    });
    expect(res.transcript).toBe('oi');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ideia-media-manage/audio-upload-url');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      ideia_id: 'i1',
      mime_type: 'audio/webm;codecs=opus',
      size_bytes: 3,
    });
    expect(FakeXHR.last?.url).toBe('https://r2/put');
    expect(FakeXHR.last?.headers['Content-Type']).toBe('audio/webm');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ideia-media-manage/i1/audio');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      r2_key: 'ideia-audio/c/i/x.webm',
      mime_type: 'audio/webm',
      size_bytes: 3,
      duration_seconds: 3,
    });
    expect(phases).toEqual(['uploading', 'transcribing']);
  });

  it('retries and deletes on the nested routes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, transcript: null, audio: null })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, transcript: null, audio: null })),
      );
    await retryIdeiaTranscription('i1');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/ideia-media-manage/i1/audio/transcribe');
    await deleteIdeiaAudio('i1');
    expect(String(fetchMock.mock.calls[1][0])).toContain('/ideia-media-manage/i1/audio');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('surfaces the backend error code', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'quota_exceeded' }), { status: 413 }),
    );
    await expect(fetchIdeiaAudio('i1')).rejects.toThrow('quota_exceeded');
  });
});
