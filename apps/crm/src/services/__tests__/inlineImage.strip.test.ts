import { describe, expect, it } from 'vitest';
import { injectSignedUrls, stripSignedUrls } from '../inlineImage';

const stored = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'oi' }] },
    {
      type: 'inlineImage',
      attrs: { r2Key: 'conta/1/a.png', src: 'https://media.example/a.png', width: 10 },
    },
    { type: 'inlineImage', attrs: { r2Key: null, src: 'https://external.example/b.png' } },
    { type: 'inlineImage', attrs: { loading: true, blurSrc: 'data:image/png;base64,x' } },
  ],
};

describe('stripSignedUrls', () => {
  it('drops src only from images identified by r2Key', () => {
    const out = stripSignedUrls(stored) as typeof stored;
    expect(out.content[1].attrs).toEqual({ r2Key: 'conta/1/a.png', width: 10 });
    expect(out.content[2]).toEqual(stored.content[2]);
    expect(out.content[3]).toEqual(stored.content[3]);
    expect(out.content[0]).toEqual(stored.content[0]);
  });

  it('makes an open-without-edit round trip stable regardless of the signed URL', () => {
    const signedA = injectSignedUrls(stored, { 'conta/1/a.png': 'https://r2/a?X-Amz=1' });
    const signedB = injectSignedUrls(stored, { 'conta/1/a.png': 'https://r2/a?X-Amz=2' });
    expect(stripSignedUrls(signedA)).toEqual(stripSignedUrls(signedB));
  });

  it('does not mutate its input', () => {
    const copy = structuredClone(stored);
    stripSignedUrls(stored);
    expect(stored).toEqual(copy);
  });
});
