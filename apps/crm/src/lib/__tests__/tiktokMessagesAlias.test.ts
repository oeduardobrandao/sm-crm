import { describe, expect, it } from 'vitest';
import { TIKTOK_MSG, tiktokErrorMessage } from '@mesaas/tiktok-messages';

describe('@mesaas/tiktok-messages alias', () => {
  it('resolves the shared module from the CRM', () => {
    expect(tiktokErrorMessage('spam_risk_too_many_posts')).toMatch(/limite diário/);
    expect(TIKTOK_MSG.mediaMissing).toBe('Adicione mídia ao post para publicar no TikTok.');
  });
});
