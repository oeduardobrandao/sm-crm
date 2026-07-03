import { describe, expect, it } from 'vitest';
import { collectDocFileIds } from '../lib/imageResolution';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

describe('collectDocFileIds', () => {
  it('returns empty for a doc with no image references', () => {
    expect(collectDocFileIds(makeDoc())).toEqual([]);
  });

  it('collects a background image file_id', () => {
    const doc = makeDoc({
      pages: [makePage({ background: { type: 'image', file_id: 42, fit: 'cover' } })],
    });
    expect(collectDocFileIds(doc)).toEqual([42]);
  });

  it('collects image-layer file_ids alongside background', () => {
    const doc = makeDoc({
      pages: [
        makePage({
          background: { type: 'image', file_id: 42, fit: 'cover' },
          layers: [
            {
              ...makeTextLayer({ id: 'img' }),
              type: 'image',
              h: 100,
              file_id: 7,
              fit: 'cover',
            } as never,
          ],
        }),
      ],
    });
    expect(collectDocFileIds(doc).sort((a, b) => a - b)).toEqual([7, 42]);
  });

  it('dedupes the same file_id used as both a background and a layer image, across pages', () => {
    const doc = makeDoc({
      pages: [
        makePage({
          id: 'p1',
          background: { type: 'image', file_id: 42, fit: 'cover' },
        }),
        makePage({
          id: 'p2',
          layers: [
            {
              ...makeTextLayer({ id: 'img' }),
              type: 'image',
              h: 100,
              file_id: 42,
              fit: 'cover',
            } as never,
          ],
        }),
      ],
    });
    expect(collectDocFileIds(doc)).toEqual([42]);
  });

  it('ignores solid and gradient backgrounds', () => {
    const doc = makeDoc({
      pages: [
        makePage({
          background: {
            type: 'linear_gradient',
            angle: 0,
            stops: [
              { color: '#000000', at: 0 },
              { color: '#ffffff', at: 1 },
            ],
          },
        }),
      ],
    });
    expect(collectDocFileIds(doc)).toEqual([]);
  });
});
