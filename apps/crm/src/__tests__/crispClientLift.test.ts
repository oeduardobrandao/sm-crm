import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import { readCrmCss } from '../test/readCrmCss';

/**
 * The Crisp bubble is lifted above the phone tab bar with a transform on `.crisp-client`. A
 * transform makes that element the containing block of Crisp's `position: fixed` chat panel, and
 * on phones Crisp opens the panel full screen after collapsing html/body to 0x0. A lift that
 * stays on while the chat is open sizes the panel against a 0x0 box: the page goes blank with no
 * way to close the chat (the "Chat de suporte" breaks the iOS app bug). So every rule that moves
 * `.crisp-client` must only match while the panel reports closed.
 */
const CLOSED_GUARD = ":has([data-chat-status][data-visible='false'])";
// Properties that make an element the containing block of its fixed-position descendants.
const CONTAINING_BLOCK_PROPS = new Set([
  'transform',
  'translate',
  'rotate',
  'scale',
  'perspective',
  'filter',
  'backdrop-filter',
  '-webkit-backdrop-filter',
  'contain',
  'container-type',
  'will-change',
]);

function crispRules() {
  const root = postcss.parse(readCrmCss());
  const found: { selector: string; prop: string }[] = [];
  root.walkRules((rule) => {
    for (const selector of rule.selectors) {
      // Only the compound that names .crisp-client itself, not a .crisp-client inside a :has().
      const targetsCrispRoot = /\.crisp-client(?![\w-])/.test(
        selector.replace(/:has\([^)]*\)/g, ''),
      );
      if (!targetsCrispRoot) continue;
      rule.walkDecls((decl) => {
        if (CONTAINING_BLOCK_PROPS.has(decl.prop)) found.push({ selector, prop: decl.prop });
      });
    }
  });
  return found;
}

describe('.crisp-client lift', () => {
  it('still lifts the closed bubble somewhere', () => {
    expect(crispRules().some((r) => r.prop === 'transform')).toBe(true);
  });

  it('never moves .crisp-client while the chat panel is open', () => {
    for (const { selector, prop } of crispRules()) {
      expect(selector.replace(/\s+/g, ' '), `${prop} on "${selector}"`).toContain(
        `.crisp-client${CLOSED_GUARD}`,
      );
    }
  });
});
