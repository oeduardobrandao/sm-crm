import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { readCrmCss } from '../test/readCrmCss';

/**
 * The boxes that stay mounted for the whole signed-in session (html, body, #root, .app-container,
 * .main-content) never size their width in viewport units.
 *
 * iPad app (2026-11-19): after a trip to Instagram or to Safari (Abrir PDF), the report editor and
 * analytics came back with the in-flow content at about half the screen width (an iPadOS snapshot
 * size) while the media queries, the fixed Camadas rail and the tab bar used the full width. A
 * route change, which re-styles .app-container's subtree, cured it. Layout-relative sizing (the
 * ICB, `%`, `position: fixed`) was right, so these boxes use `100%`; a `100vw` resolved at the
 * snapshot size is the suspect. Not reproduced in the Simulator, where the resize only arrives
 * once the app is back in the foreground.
 */

const CHAIN = new Set(['html', 'body', '#root', '.app-container', '.main-content']);
const WIDTH_PROPS = new Set(['width', 'max-width', 'min-width', 'inline-size', 'max-inline-size']);
const VIEWPORT_WIDTH_UNIT = /\d(?:vw|dvw|svw|lvw|vmin|vmax|vi)\b/;

function chainWidthDeclarations(): string[] {
  const root = postcss.parse(readCrmCss());
  const found: string[] = [];
  root.walkRules((rule) => {
    const targets = rule.selectors.map((s) => s.trim()).filter((s) => CHAIN.has(s));
    if (targets.length === 0) return;
    rule.walkDecls((decl) => {
      if (WIDTH_PROPS.has(decl.prop) && VIEWPORT_WIDTH_UNIT.test(decl.value)) {
        found.push(`${targets.join(', ')} { ${decl.prop}: ${decl.value} }`);
      }
    });
  });
  return found;
}

describe('shell chain viewport units', () => {
  it('sizes html, body, #root, .app-container and .main-content without vw', () => {
    expect(chainWidthDeclarations()).toEqual([]);
  });
});
