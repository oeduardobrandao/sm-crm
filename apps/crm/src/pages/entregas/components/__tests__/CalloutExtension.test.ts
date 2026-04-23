import { describe, expect, it } from 'vitest';
import { CalloutExtension, CALLOUT_COLORS } from '../CalloutExtension';

describe('CalloutExtension', () => {
  it('is named "callout"', () => {
    expect(CalloutExtension.name).toBe('callout');
  });

  it('has emoji and color attributes with defaults', () => {
    const attrs = CalloutExtension.config.addAttributes!.call(CalloutExtension);
    expect(attrs.emoji.default).toBe('💡');
    expect(attrs.color.default).toBe('brown');
  });

  it('parses from div[data-callout]', () => {
    const parseRules = CalloutExtension.config.parseHTML!.call(CalloutExtension);
    expect(parseRules).toContainEqual({ tag: 'div[data-callout]' });
  });

  it('is a block-level node with block+ content', () => {
    expect(CalloutExtension.config.group).toBe('block');
    expect(CalloutExtension.config.content).toBe('block+');
  });

  it('exports all 8 color options', () => {
    expect(CALLOUT_COLORS).toHaveLength(8);
    const values = CALLOUT_COLORS.map(c => c.value);
    expect(values).toContain('brown');
    expect(values).toContain('blue');
    expect(values).toContain('green');
    expect(values).toContain('yellow');
  });
});
