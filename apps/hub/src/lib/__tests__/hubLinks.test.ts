import { describe, expect, it } from 'vitest';
import { buildHubPostLink, canonicalHubToken, compactHubToken } from '../hubLinks';

describe('buildHubPostLink', () => {
  it('appends the postagens path to a relative base', () => {
    expect(buildHubPostLink('/mesaas/hub/tok', 42)).toBe('/mesaas/hub/tok/postagens/42');
  });
  it('works with an absolute base', () => {
    expect(buildHubPostLink('https://app.mesaas.com.br/mesaas/hub/tok', 7)).toBe(
      'https://app.mesaas.com.br/mesaas/hub/tok/postagens/7',
    );
  });
  it('trims a single trailing slash on the base', () => {
    expect(buildHubPostLink('/mesaas/hub/tok/', 9)).toBe('/mesaas/hub/tok/postagens/9');
  });
});

const UUID = 'b6a359fb-af56-470a-8f0a-7e215a67b9b9';
const COMPACT = 'b6a359fbaf56470a8f0a7e215a67b9b9';

describe('compactHubToken', () => {
  it('drops the hyphens from a UUID', () => {
    expect(compactHubToken(UUID)).toBe(COMPACT);
  });
  it('leaves an already compact token alone', () => {
    expect(compactHubToken(COMPACT)).toBe(COMPACT);
  });
  it('leaves a non-UUID token alone', () => {
    expect(compactHubToken('tok-1')).toBe('tok-1');
  });
});

describe('canonicalHubToken', () => {
  it('restores the hyphens of a compact token', () => {
    expect(canonicalHubToken(COMPACT)).toBe(UUID);
  });
  it('lowercases an uppercase compact token', () => {
    expect(canonicalHubToken(COMPACT.toUpperCase())).toBe(UUID);
  });
  it('leaves a hyphenated UUID alone (old links)', () => {
    expect(canonicalHubToken(UUID)).toBe(UUID);
  });
  it('leaves a non-UUID token alone', () => {
    expect(canonicalHubToken('tok-1')).toBe('tok-1');
  });
  it('round-trips with compactHubToken', () => {
    expect(canonicalHubToken(compactHubToken(UUID))).toBe(UUID);
  });
});
