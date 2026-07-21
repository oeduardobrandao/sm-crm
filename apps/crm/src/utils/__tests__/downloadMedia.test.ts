import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadMedia } from '../downloadMedia';

const OBJECT_URL = 'blob:mock-object-url';

let clicked: HTMLAnchorElement[];

beforeEach(() => {
  clicked = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new Blob(['bytes']), { status: 200 })),
  );
  URL.createObjectURL = vi.fn(() => OBJECT_URL);
  URL.revokeObjectURL = vi.fn();
  // jsdom has no navigation, so a real anchor click would warn. Record instead.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push(this);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadMedia', () => {
  it('saves the file under its original filename', async () => {
    await downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' });

    expect(fetch).toHaveBeenCalledWith('https://media.test/abc.png', expect.anything());
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('capa.png');
    expect(clicked[0].href).toBe(OBJECT_URL);
  });

  it('releases the object url and detaches the anchor', async () => {
    await downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' });

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('rejects media with no url without fetching', async () => {
    await expect(downloadMedia({ url: null, original_filename: 'capa.png' })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('propagates a failed download so the caller can surface it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 403 })),
    );

    await expect(
      downloadMedia({ url: 'https://media.test/abc.png', original_filename: 'capa.png' }),
    ).rejects.toThrow(/403/);
    expect(clicked).toHaveLength(0);
  });
});
