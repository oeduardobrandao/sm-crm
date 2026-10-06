import { describe, expect, it } from 'vitest';
import { FEATURE_FLAG_KEYS, FEATURE_FLAG_LABELS } from '../api';

describe('flags de plano no Admin', () => {
  it('conhece feature_post_processes e feature_agenda e tem rótulo para cada flag', () => {
    expect(FEATURE_FLAG_KEYS).toContain('feature_post_processes');
    expect(FEATURE_FLAG_KEYS).toContain('feature_agenda');
    expect(FEATURE_FLAG_LABELS.feature_agenda).toBe('Agenda');
    for (const key of FEATURE_FLAG_KEYS) {
      expect(FEATURE_FLAG_LABELS[key], `sem rótulo para ${key}`).toBeTruthy();
    }
  });
});
