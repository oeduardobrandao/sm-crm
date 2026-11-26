// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import PrivacyPageEn from '../PrivacyPageEn';
import TermsPageEn from '../TermsPageEn';

/** Visible text, with tags stripped and entities decoded, so assertions read like the page. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}

const privacyHtml = renderToStaticMarkup(<PrivacyPageEn />);
const termsHtml = renderToStaticMarkup(<TermsPageEn />);
const privacy = textOf(privacyHtml);
const terms = textOf(termsHtml);

describe('PrivacyPageEn', () => {
  it('renders in Node without a browser', () => {
    expect(typeof window).toBe('undefined');
    expect(privacyHtml.length).toBeGreaterThan(1000);
  });

  it.each([
    'Information we collect',
    'How we use information',
    'How we share information',
    'Sale and sharing',
    'Your privacy rights',
  ])('has a section heading for %s', (heading) => {
    expect(privacyHtml).toMatch(new RegExp(`<h2[^>]*>[^<]*${heading}`, 'i'));
  });

  it.each([
    'right to know',
    'right to delete',
    'right to correct',
    'right to opt out',
    'right to limit',
    'sensitive personal information',
    'non-discrimination',
    'authorized agent',
    'appeal',
  ])('lists the %s', (right) => {
    expect(privacy.toLowerCase()).toContain(right);
  });

  it('has the cookies anchor, GPC, children, contact and entity', () => {
    expect(privacyHtml).toContain('id="cookies"');
    expect(privacy).toContain('Global Privacy Control');
    expect(privacy).toMatch(/children under 13/i);
    expect(privacy).toContain('privacidade@mesaas.com.br');
    expect(privacy).toContain('EBS IT SOLUTIONS');
  });

  it('names the processors of the Portuguese policy', () => {
    for (const name of [
      'Supabase',
      'Cloudflare',
      'Stripe',
      'PostHog',
      'Resend',
      'Crisp',
      'Google',
      'Meta',
      'OpenAI',
      'Vercel',
    ]) {
      expect(privacy).toContain(name);
    }
  });

  it('mirrors the Portuguese retention periods', () => {
    expect(privacy).toMatch(/within 30 days/i);
    expect(privacy).toMatch(/90 days/);
    expect(privacy).toMatch(/7 days/);
  });
});

describe('TermsPageEn', () => {
  it('renders in Node without a browser', () => {
    expect(termsHtml.length).toBeGreaterThan(1000);
  });

  it('covers USD billing, renewal, trials and governing law', () => {
    expect(terms).toMatch(/automatic renewal/i);
    expect(terms).toMatch(/cancel at any time|cancel anytime/i);
    expect(terms).toContain('USD');
    expect(terms).toContain('Stripe');
    expect(terms).toMatch(/14 days of Pro/i);
    expect(terms).toMatch(/no card|without a card/i);
    expect(terms).toMatch(/laws of the Federative Republic of Brazil|laws of Brazil/i);
    expect(terms).toContain('Salvador');
  });
});

describe('English legal copy rules', () => {
  it.each([
    ['privacy', privacy],
    ['terms', terms],
  ])('%s has no LGPD, CNPJ, em-dash or Meta approval claim', (_name, text) => {
    expect(text).not.toContain('LGPD');
    expect(text).not.toContain('CNPJ');
    expect(text).not.toContain('\u2014');
    expect(text).not.toMatch(/approved by Meta/i);
  });
});
