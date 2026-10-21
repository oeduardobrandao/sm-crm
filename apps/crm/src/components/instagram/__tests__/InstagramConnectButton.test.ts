import { describe, expect, it } from 'vitest';
import { renderInstagramConnectButton } from '../InstagramConnectButton';

describe('renderInstagramConnectButton', () => {
  it('renders the connect button with the official-API trust line underneath', () => {
    const container = document.createElement('div');

    renderInstagramConnectButton(container, 42);

    expect(container.querySelector('#btn-ig-connect')).not.toBeNull();
    const trust = container.querySelector('.instagram-connect__trust');
    expect(trust).not.toBeNull();
    expect(trust).toHaveTextContent(/API oficial do Instagram/);
    expect(trust?.querySelector('.ph-lock')).not.toBeNull();
  });

  it('uses Phosphor icons for the card header and the button (Font Awesome is not loaded)', () => {
    const container = document.createElement('div');

    renderInstagramConnectButton(container, 42);

    expect(container.querySelector('.card > div:first-child .ph-instagram-logo')).not.toBeNull();
    expect(container.querySelector('#btn-ig-connect .ph-instagram-logo')).not.toBeNull();
    expect(container.querySelector('[class*="fa-"]')).toBeNull();
  });
});
