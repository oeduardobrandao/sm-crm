import { describe, expect, test } from 'vitest';
import { renderPrecosHtml } from '../precos.seo';
import { PRECOS } from '../precos.content';

describe('renderPrecosHtml', () => {
  const html = renderPrecosHtml();
  test('one h1, all plans, all FAQs', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    for (const p of PRECOS.plans) expect(html).toContain(p.name);
    for (const i of PRECOS.faq) expect(html).toContain(i.q.replace(/&/g, '&amp;'));
  });
});
