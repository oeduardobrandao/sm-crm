import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// public/oaiq-frame.js is a plain script served as is; run its source against a fake frame.
const SOURCE = readFileSync(path.resolve(__dirname, '../../../../../public/oaiq-frame.js'), 'utf8');
const HTML = readFileSync(path.resolve(__dirname, '../../../../../public/oaiq-frame.html'), 'utf8');

type Oaiq = ((...args: unknown[]) => void) & { q: IArguments[] };

function runFrame(parent: { postMessage: ReturnType<typeof vi.fn> }) {
  const listeners: Array<(event: MessageEvent) => void> = [];
  const head = { appendChild: vi.fn() };
  const fakeWindow = {
    parent,
    location: { origin: 'https://mesaas.com.br' },
    addEventListener: (_type: string, fn: (event: MessageEvent) => void) => listeners.push(fn),
  } as unknown as Window & { oaiq?: Oaiq };
  const fakeDocument = { head, createElement: () => ({}) as HTMLScriptElement };
  new Function('window', 'document', SOURCE)(fakeWindow, fakeDocument);
  const send = (data: unknown, origin = 'https://mesaas.com.br', source: unknown = parent) =>
    listeners.forEach((fn) => fn({ data, origin, source } as MessageEvent));
  const queued = () => (fakeWindow.oaiq?.q ?? []).map((args) => Array.from(args));
  return { fakeWindow, head, send, queued };
}

describe('oaiq-frame.js', () => {
  let parent: { postMessage: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    parent = { postMessage: vi.fn() };
  });
  afterEach(() => vi.restoreAllMocks());

  it('loads the OpenAI SDK and tells only its own origin that it is ready', () => {
    const { head } = runFrame(parent);
    expect(head.appendChild).toHaveBeenCalledWith(
      expect.objectContaining({ src: 'https://bzrcdn.openai.com/sdk/oaiq.min.js', async: true }),
    );
    expect(parent.postMessage).toHaveBeenCalledWith(
      { channel: 'mesaas-oaiq', ready: true },
      'https://mesaas.com.br',
    );
  });

  it('forwards init, consent and measure from the parent into the stub queue', () => {
    const { send, queued } = runFrame(parent);
    send({ channel: 'mesaas-oaiq', call: ['init', { pixelId: 'P' }] });
    send({ channel: 'mesaas-oaiq', call: ['measure', 'page_viewed', { type: 'contents' }] });
    expect(queued()).toEqual([
      ['init', { pixelId: 'P' }],
      ['measure', 'page_viewed', { type: 'contents' }],
    ]);
  });

  it('ignores other origins, other sources, other channels and other commands', () => {
    const { send, queued } = runFrame(parent);
    send({ channel: 'mesaas-oaiq', call: ['init', {}] }, 'https://evil.example');
    send({ channel: 'mesaas-oaiq', call: ['init', {}] }, 'https://mesaas.com.br', {});
    send({ channel: 'other', call: ['init', {}] });
    send({ channel: 'mesaas-oaiq', call: ['identify', {}] });
    send({ channel: 'mesaas-oaiq', call: 'init' });
    expect(queued()).toEqual([]);
  });

  it('does nothing when opened directly instead of as a frame', () => {
    const self = { postMessage: vi.fn() };
    const head = { appendChild: vi.fn() };
    const fakeWindow = { location: { origin: 'https://mesaas.com.br' } } as Record<string, unknown>;
    fakeWindow.parent = fakeWindow;
    fakeWindow.postMessage = self.postMessage;
    new Function('window', 'document', SOURCE)(fakeWindow, { head });
    expect(head.appendChild).not.toHaveBeenCalled();
    expect(fakeWindow.oaiq).toBeUndefined();
  });

  // Automatic advanced matching scans the document the SDK runs in: keep it empty.
  it('the frame page has no content and no script other than the frame script', () => {
    const body = HTML.slice(HTML.indexOf('<body>') + 6, HTML.indexOf('</body>'));
    expect(body.trim()).toBe('<script src="/oaiq-frame.js"></script>');
    expect(HTML.match(/<script/g)).toHaveLength(1);
  });
});
