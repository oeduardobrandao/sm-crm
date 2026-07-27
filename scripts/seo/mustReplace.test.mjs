import { describe, expect, it } from 'vitest';
import { mustReplace } from './mustReplace.ts';

describe('mustReplace', () => {
  it("inserts a replacement containing $&, $' and $$ verbatim", () => {
    const html = '<div id="root"></div>';
    // Mirrors what renderToStaticMarkup manufactures from ordinary prose
    // containing an apostrophe, an ampersand, and a literal `$$` sequence.
    const dangerous = 'PERIGO1 $&#x27; PERIGO2 $&amp; PERIGO3 $$ FIM.';
    const out = mustReplace(html, '<div id="root"></div>', dangerous, 'test:marker');
    expect(out).toBe(dangerous);
  });

  it('throws when the marker is absent', () => {
    expect(() =>
      mustReplace('<html><head></head></html>', '<div id="root"></div>', 'x', 'test:label'),
    ).toThrow('prerender: marker not found: test:label');
  });
});
