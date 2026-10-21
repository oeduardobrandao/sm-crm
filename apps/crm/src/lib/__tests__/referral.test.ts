import { describe, expect, it } from 'vitest';
import {
  REFERRAL_STORAGE_KEY,
  REFERRAL_TTL_MS,
  buildReferralLink,
  captureReferral,
  clearStoredReferral,
  getStoredReferral,
  normalizeReferralCode,
} from '../referral';

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

describe('referral attribution', () => {
  it('normalizes and validates codes like the DB check', () => {
    expect(normalizeReferralCode(' ANA7K3F ')).toBe('ana7k3f');
    expect(normalizeReferralCode('ab')).toBeNull();
    expect(normalizeReferralCode('ana-7k3f')).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });

  it('captures ?ref= and the last click wins', () => {
    const s = memoryStorage();
    expect(captureReferral('?ref=primeiro1', s, 1000)).toBe('primeiro1');
    expect(captureReferral('?utm_source=ig&ref=segundo2', s, 2000)).toBe('segundo2');
    expect(getStoredReferral(s, 2000)).toBe('segundo2');
  });

  it('ignores missing or invalid codes without clobbering a stored one', () => {
    const s = memoryStorage();
    captureReferral('?ref=valido12', s, 1000);
    expect(captureReferral('', s, 2000)).toBeNull();
    expect(captureReferral('?ref=<script>', s, 2000)).toBeNull();
    expect(getStoredReferral(s, 2000)).toBe('valido12');
  });

  it('expires after 60 days and cleans up', () => {
    const s = memoryStorage();
    captureReferral('?ref=valido12', s, 0);
    expect(getStoredReferral(s, REFERRAL_TTL_MS)).toBe('valido12');
    expect(getStoredReferral(s, REFERRAL_TTL_MS + 1)).toBeNull();
    expect(s.map.has(REFERRAL_STORAGE_KEY)).toBe(false);
  });

  it('survives corrupt storage and missing storage', () => {
    const s = memoryStorage();
    s.setItem(REFERRAL_STORAGE_KEY, '{not json');
    expect(getStoredReferral(s, 0)).toBeNull();
    expect(captureReferral('?ref=valido12', null)).toBeNull();
    expect(getStoredReferral(null)).toBeNull();
  });

  it('clears after use', () => {
    const s = memoryStorage();
    captureReferral('?ref=valido12', s, 0);
    clearStoredReferral(s);
    expect(getStoredReferral(s, 0)).toBeNull();
  });

  it('builds the public link', () => {
    expect(buildReferralLink('ana7k3f')).toBe('https://www.mesaas.com.br/?ref=ana7k3f');
  });
});
