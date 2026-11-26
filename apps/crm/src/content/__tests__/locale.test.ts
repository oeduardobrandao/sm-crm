import { describe, expect, it } from 'vitest';
import { landingContent, precosContent } from '../locale';
import { localizedPath, signupHref, siteLocaleForPath } from '../locale';
import { LANDING } from '../landing.content';
import { LANDING_EN } from '../landing.content.en';
import { PRECOS } from '../precos.content';
import { PRECOS_EN } from '../precos.content.en';

describe('siteLocaleForPath', () => {
  it('maps /en and its subpaths to en', () => {
    expect(siteLocaleForPath('/en')).toBe('en');
    expect(siteLocaleForPath('/en/')).toBe('en');
    expect(siteLocaleForPath('/en/pricing')).toBe('en');
  });

  it('maps everything else to pt', () => {
    expect(siteLocaleForPath('/')).toBe('pt');
    expect(siteLocaleForPath('/english')).toBe('pt');
    expect(siteLocaleForPath('/enx')).toBe('pt');
    expect(siteLocaleForPath('/precos')).toBe('pt');
  });
});

describe('localizedPath', () => {
  it('returns the pt paths', () => {
    expect(localizedPath('pt', 'home')).toBe('/');
    expect(localizedPath('pt', 'pricing')).toBe('/precos');
    expect(localizedPath('pt', 'privacy')).toBe('/politica-de-privacidade');
    expect(localizedPath('pt', 'terms')).toBe('/termos-de-uso');
  });

  it('returns the en paths', () => {
    expect(localizedPath('en', 'home')).toBe('/en');
    expect(localizedPath('en', 'pricing')).toBe('/en/pricing');
    expect(localizedPath('en', 'privacy')).toBe('/en/privacy');
    expect(localizedPath('en', 'terms')).toBe('/en/terms');
  });
});

describe('signupHref', () => {
  it('keeps the pt links exactly as the landing builds them today', () => {
    expect(signupHref('pt')).toBe('/login?tab=register');
    expect(signupHref('pt', 'pro')).toBe('/login?tab=register&plan=pro&interval=month');
    expect(signupHref('pt', 'max', 'year')).toBe('/login?tab=register&plan=max&interval=year');
  });

  it('adds market=us for en and keeps the same intent params', () => {
    expect(signupHref('en')).toBe('/login?tab=register&market=us');
    const en = signupHref('en', 'pro');
    expect(en).toContain('market=us');
    expect(en).toContain('plan=pro');
    expect(en).toContain('interval=month');
  });
});

describe('content selectors', () => {
  it('pick the module for each locale', () => {
    expect(landingContent('pt')).toBe(LANDING);
    expect(landingContent('en')).toBe(LANDING_EN);
    expect(precosContent('pt')).toBe(PRECOS);
    expect(precosContent('en')).toBe(PRECOS_EN);
  });
});
