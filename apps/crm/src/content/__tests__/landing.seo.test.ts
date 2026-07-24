import { describe, expect, test } from 'vitest';
import { renderLandingHtml } from '../landing.seo';
import { LANDING } from '../landing.content';

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])/g)].map((m) => Number(m[1]));
}

describe('renderLandingHtml', () => {
  const html = renderLandingHtml();

  test('has exactly one h1 with the hero copy', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('Sua agência de social media');
  });

  test('never skips a heading level', () => {
    const levels = headingLevels(html);
    expect(levels[0]).toBe(1);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test('includes every feature and FAQ entry', () => {
    for (const f of LANDING.features) expect(html).toContain(f.title.replace(/&/g, '&amp;'));
    for (const item of LANDING.faq) expect(html).toContain(item.q.replace(/&/g, '&amp;'));
  });

  test('links to the funnel pages', () => {
    expect(html).toContain('href="/precos"');
    expect(html).toContain('href="/aprovacao-de-post"');
    expect(html).toContain('href="/agente-de-conteudo-ia"');
  });

  test('renders embedded <strong> markers as real tags, never escaped text', () => {
    expect(html).toContain('<strong>5 etapas padrão</strong>');
    expect(html).not.toContain('&lt;strong&gt;');
  });
});
