import { describe, expect, it } from 'vitest';
import { readCrmCss } from '@/test/readCrmCss';

/** The body of the first rule whose selector list is exactly `selector`. */
function rule(css: string, selector: string): string | null {
  const escaped = selector.replace(/[.[\]()'=]/g, '\\$&');
  const m = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  return m ? m[1] : null;
}

// jsdom does not apply stylesheets, so a pointer-events bug only shows in a real browser.
// The layer is pointer-events: none outside placing mode; everything interactive inside it
// must opt back in.
describe('CRM pin CSS (real stylesheet)', () => {
  const css = readCrmCss();

  it('the pin button opts back into pointer events', () => {
    expect(rule(css, '.crm-pin')).toMatch(/pointer-events:\s*auto/);
  });

  it('the details panel opts back into pointer events, so its buttons can be clicked', () => {
    expect(rule(css, '.crm-pin-details')).toMatch(/pointer-events:\s*auto/);
  });

  it('the anchor with open details stacks above its siblings', () => {
    const body = rule(css, ".crm-pin-anchor[data-open='true']");
    expect(body).toMatch(/z-index:\s*\d+/);
  });
});
