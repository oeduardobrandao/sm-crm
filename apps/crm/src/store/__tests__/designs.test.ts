import { describe, expect, it } from 'vitest';
import { pickThumbKey } from '../designs';

const attached = { coverKey: 'contas/c/designs/1/2/f1.jpg', videoThumbKey: 'thumb.jpg' };

describe('pickThumbKey', () => {
  it('prefers the stored render manifest (unattached designs keep it)', () => {
    expect(
      pickThumbKey(
        { render_manifest: [{ r2_key: 'manifest.jpg' }], post_id: null, format: 'feed' },
        attached,
      ),
    ).toBe('manifest.jpg');
  });

  it('attached feed/carrossel falls back to the post design cover link', () => {
    expect(pickThumbKey({ render_manifest: null, post_id: 42, format: 'feed' }, attached)).toBe(
      attached.coverKey,
    );
    expect(
      pickThumbKey({ render_manifest: null, post_id: 42, format: 'carrossel' }, attached),
    ).toBe(attached.coverKey);
  });

  it('attached reel_cover uses the post video thumbnail', () => {
    expect(
      pickThumbKey({ render_manifest: null, post_id: 42, format: 'reel_cover' }, attached),
    ).toBe(attached.videoThumbKey);
  });

  it('null when unattached with no manifest (never rendered / failed)', () => {
    expect(pickThumbKey({ render_manifest: null, post_id: null, format: 'livre' })).toBe(null);
    expect(pickThumbKey({ render_manifest: [], post_id: null, format: 'feed' })).toBe(null);
  });

  it('null when attached but media sources are empty', () => {
    expect(
      pickThumbKey(
        { render_manifest: null, post_id: 42, format: 'feed' },
        { coverKey: null, videoThumbKey: null },
      ),
    ).toBe(null);
  });
});
