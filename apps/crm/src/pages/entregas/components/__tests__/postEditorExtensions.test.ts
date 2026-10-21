import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSchema } from '@tiptap/core';
import { postEditorExtensions } from '../PostEditor';

// Regression guard for Finding 2 (task-9 fix round 1): StarterKit v3 already bundles
// Link and Underline. Registering `UnderlineExt` and `Link.configure(...)` again on top
// without `StarterKit.configure({ link: false, underline: false })` left TWO Link
// extensions alive with conflicting options -- StarterKit's own `openOnClick: true`
// (its default) ran alongside the `openOnClick: false` configured here, so clicking a
// link while editing navigated the whole tab away instead of doing nothing.
describe('postEditorExtensions', () => {
  const build = () =>
    postEditorExtensions({ mentionSearch: async () => [], onUploadInlineImage: undefined });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not warn about duplicate extension names', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    getSchema(build());

    const duplicateWarning = warnSpy.mock.calls.find((call) =>
      String(call[0]).includes('Duplicate extension names found'),
    );
    expect(duplicateWarning).toBeUndefined();
  });

  it('registers exactly one link extension', () => {
    const names = build().map((extension) => (extension as { name: string }).name);
    expect(names.filter((name) => name === 'link')).toHaveLength(1);
    expect(names.filter((name) => name === 'underline')).toHaveLength(1);
  });
});
