import { describe, expect, it } from 'vitest';
import {
  formatReferenceDate,
  formatReferenceDuration,
  formatReferenceSize,
  isViewableReference,
  referenceLabel,
} from '../references/referenceFormat';
import type { ReferenceItem } from '@/store/postReferences';

function item(overrides: Partial<ReferenceItem>): ReferenceItem {
  return {
    id: 1,
    kind: 'file',
    file_kind: 'image',
    name: 'foto.jpg',
    mime_type: 'image/jpeg',
    size_bytes: 1000,
    duration_seconds: null,
    width: null,
    height: null,
    url: 'https://r2.example.com/a.jpg',
    thumbnail_url: null,
    blur_data_url: null,
    download_url: null,
    link_url: null,
    link_title: null,
    link_domain: null,
    note: null,
    post_approval_id: null,
    created_at: '2026-10-08T12:00:00.000Z',
    can_remove: false,
    ...overrides,
  };
}

describe('referenceFormat', () => {
  it('formats sizes in pt-BR', () => {
    expect(formatReferenceSize(2_516_582)).toBe('2,4 MB');
    expect(formatReferenceSize(2 * 1024 * 1024)).toBe('2 MB');
    expect(formatReferenceSize(300 * 1024)).toBe('300 KB');
    expect(formatReferenceSize(10)).toBe('1 KB');
    expect(formatReferenceSize(null)).toBeNull();
    expect(formatReferenceSize(0)).toBeNull();
  });

  it('formats the date relative to today, in local time', () => {
    const now = new Date(2026, 9, 8, 18, 0);
    expect(formatReferenceDate(new Date(2026, 9, 8, 14, 32).toISOString(), now)).toBe(
      'hoje, 14:32',
    );
    expect(formatReferenceDate(new Date(2026, 9, 7, 9, 5).toISOString(), now)).toBe(
      'ontem, 09:05',
    );
    expect(formatReferenceDate(new Date(2026, 9, 3, 8, 0).toISOString(), now)).toBe(
      '3 out, 08:00',
    );
    expect(formatReferenceDate(new Date(2025, 11, 30, 8, 0).toISOString(), now)).toBe(
      '30 dez 2025, 08:00',
    );
    expect(formatReferenceDate('not a date', now)).toBe('');
  });

  it('formats video durations', () => {
    expect(formatReferenceDuration(42)).toBe('0:42');
    expect(formatReferenceDuration(65.4)).toBe('1:05');
    expect(formatReferenceDuration(3725)).toBe('1:02:05');
    expect(formatReferenceDuration(null)).toBeNull();
  });

  it('labels files by name and links by title, then domain', () => {
    expect(referenceLabel(item({ name: 'a.pdf' }))).toBe('a.pdf');
    expect(referenceLabel(item({ name: null }))).toBe('Arquivo');
    expect(
      referenceLabel(item({ kind: 'link', link_title: 'Gostei', link_domain: 'instagram.com' })),
    ).toBe('Gostei');
    expect(referenceLabel(item({ kind: 'link', link_title: ' ', link_domain: 'x.com' }))).toBe(
      'x.com',
    );
  });

  it('only images and videos open in the viewer', () => {
    expect(isViewableReference(item({ file_kind: 'image' }))).toBe(true);
    expect(isViewableReference(item({ file_kind: 'video' }))).toBe(true);
    expect(isViewableReference(item({ file_kind: 'document' }))).toBe(false);
    expect(isViewableReference(item({ kind: 'link', file_kind: null, url: null }))).toBe(false);
    expect(isViewableReference(item({ url: null }))).toBe(false);
  });
});
