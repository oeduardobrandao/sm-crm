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
});
