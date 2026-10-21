import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Tripwire for the cookie-consent gate: index.html may only carry the $crisp queue. The widget
// script is injected by lib/crispLoader.ts after the visitor consents to the support category.
// A hard-coded <script src="https://client.crisp.chat/l.js"> here would load Crisp (and set its
// cookies) before any consent.
describe('apps/crm/index.html consent gate', () => {
  const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');

  it('keeps the $crisp queue so pushes made before consent are harmless', () => {
    expect(html).toContain('window.$crisp=[]');
  });

  it('does not load the Crisp widget script directly', () => {
    expect(html).not.toContain('client.crisp.chat');
  });
});
