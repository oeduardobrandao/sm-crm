import { describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_V,
  buildDocUrl,
  buildEditorUrl,
  createEmbedHost,
  type EditorEvent,
} from '../embedHost';

const EDITOR_ORIGIN = 'http://localhost:1420';

function makeHost(overrides: Partial<Parameters<typeof createEmbedHost>[0]> = {}) {
  const postToEditor = vi.fn();
  const onEvent = vi.fn();
  const onAuthError = vi.fn();
  const getAccessToken = vi.fn(async () => 'tok-1');
  const host = createEmbedHost({
    editorOrigin: EDITOR_ORIGIN,
    getAccessToken,
    postToEditor,
    onEvent,
    onAuthError,
    ...overrides,
  });
  return { host, postToEditor, onEvent, onAuthError, getAccessToken };
}

function msg(data: unknown, origin = EDITOR_ORIGIN): MessageEvent {
  return { origin, data } as MessageEvent;
}

// flush the fire-and-forget sendAuth promise inside handleMessage
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('createEmbedHost', () => {
  it('drops messages from a different origin', async () => {
    const { host, onEvent, postToEditor } = makeHost();
    host.handleMessage(msg({ v: 1, type: 'ready' }, 'https://evil.example'));
    await tick();
    expect(onEvent).not.toHaveBeenCalled();
    expect(postToEditor).not.toHaveBeenCalled();
  });

  it('drops non-v1 and unknown-type messages', async () => {
    const { host, onEvent, postToEditor } = makeHost();
    host.handleMessage(msg({ v: 2, type: 'ready' }));
    host.handleMessage(msg({ type: 'ready' }));
    host.handleMessage(msg({ v: 1, type: 'not-a-thing' }));
    host.handleMessage(msg(null));
    host.handleMessage(msg('string'));
    await tick();
    expect(onEvent).not.toHaveBeenCalled();
    expect(postToEditor).not.toHaveBeenCalled();
  });

  it('replies to ready with auth (no forced refresh) and forwards the event', async () => {
    const { host, onEvent, postToEditor, getAccessToken } = makeHost();
    host.handleMessage(msg({ v: 1, type: 'ready' }));
    await tick();
    expect(getAccessToken).toHaveBeenCalledWith(false);
    expect(postToEditor).toHaveBeenCalledWith(
      { v: BRIDGE_V, type: 'auth', accessToken: 'tok-1' },
      EDITOR_ORIGIN,
    );
    expect(onEvent).toHaveBeenCalledWith({ v: 1, type: 'ready' });
  });

  it('replies to auth:needed with a FORCED token refresh', async () => {
    const { host, postToEditor, getAccessToken } = makeHost();
    host.handleMessage(msg({ v: 1, type: 'auth:needed' }));
    await tick();
    expect(getAccessToken).toHaveBeenCalledWith(true);
    expect(postToEditor).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth' }),
      EDITOR_ORIGIN,
    );
  });

  it('does not post auth when no token is available', async () => {
    const { host, postToEditor } = makeHost({ getAccessToken: vi.fn(async () => null) });
    host.handleMessage(msg({ v: 1, type: 'ready' }));
    await tick();
    expect(postToEditor).not.toHaveBeenCalled();
  });

  it('routes getAccessToken failures to onAuthError instead of throwing', async () => {
    const boom = new Error('refresh failed');
    const { host, onAuthError, postToEditor } = makeHost({
      getAccessToken: vi.fn(async () => {
        throw boom;
      }),
    });
    host.handleMessage(msg({ v: 1, type: 'ready' }));
    await tick();
    expect(onAuthError).toHaveBeenCalledWith(boom);
    expect(postToEditor).not.toHaveBeenCalled();
  });

  it('forwards doc:loaded / save:ok / save:conflict / save:error / dirty to onEvent', () => {
    const { host, onEvent } = makeHost();
    const events = [
      { v: 1, type: 'doc:loaded', rev: 3 },
      { v: 1, type: 'save:ok', rev: 4, bytes: 29184 },
      { v: 1, type: 'save:conflict', rev: 4 },
      { v: 1, type: 'save:error', message: 'nope' },
      { v: 1, type: 'dirty', dirty: true },
    ];
    for (const e of events) host.handleMessage(msg(e));
    expect(onEvent.mock.calls.map(([e]: [EditorEvent]) => e)).toEqual(events);
  });

  it('forceSave posts a v1 save message', () => {
    const { host, postToEditor } = makeHost();
    host.forceSave();
    expect(postToEditor).toHaveBeenCalledWith({ v: BRIDGE_V, type: 'save' }, EDITOR_ORIGIN);
  });

  it('sendAuth can be called directly (proactive token refresh)', async () => {
    const { host, postToEditor, getAccessToken } = makeHost();
    await host.sendAuth();
    expect(getAccessToken).toHaveBeenCalledWith(false);
    expect(postToEditor).toHaveBeenCalledTimes(1);
  });
});

describe('URL builders', () => {
  it('buildEditorUrl matches the frozen embed URL shape', () => {
    expect(buildEditorUrl(EDITOR_ORIGIN, 'https://x.y/blob?post_id=7', 'http://localhost:5173')).toBe(
      'http://localhost:1420/?embed=1&docUrl=https%3A%2F%2Fx.y%2Fblob%3Fpost_id%3D7&parentOrigin=http%3A%2F%2Flocalhost%3A5173',
    );
  });

  it('buildDocUrl uses the CRM proxy in dev and Supabase directly in prod', () => {
    const env = { appOrigin: 'http://localhost:5173', supabaseUrl: 'https://proj.supabase.co' };
    expect(buildDocUrl(1041, { ...env, dev: true })).toBe(
      'http://localhost:5173/estudio-fn/post-design-manage/blob?post_id=1041',
    );
    expect(buildDocUrl(1041, { ...env, dev: false })).toBe(
      'https://proj.supabase.co/functions/v1/post-design-manage/blob?post_id=1041',
    );
  });
});
