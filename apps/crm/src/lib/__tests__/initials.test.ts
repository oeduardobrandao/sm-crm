import { describe, expect, it } from 'vitest';
import { getInitials } from '../initials';

describe('getInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(getInitials('Débora Kristin')).toBe('DK');
    expect(getInitials('joana lima')).toBe('JL');
    expect(getInitials('Mariana Torres de Carvalho')).toBe('MT');
  });

  it('returns a single letter for a single word', () => {
    expect(getInitials('Eduardo')).toBe('E');
    expect(getInitials('?')).toBe('?');
  });

  it('returns an empty string for an empty name', () => {
    expect(getInitials('')).toBe('');
  });

  it('skips the empty segments left by extra spaces', () => {
    expect(getInitials('Ana  Maria')).toBe('AM');
    expect(getInitials(' Ana')).toBe('A');
    expect(getInitials('Ana ')).toBe('A');
    expect(getInitials('   ')).toBe('');
  });
});
