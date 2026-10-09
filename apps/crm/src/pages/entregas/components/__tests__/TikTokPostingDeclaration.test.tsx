import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  BRANDED_CONTENT_POLICY_URL,
  MUSIC_USAGE_CONFIRMATION_URL,
  TikTokPostingDeclaration,
} from '../TikTokPostingDeclaration';

describe('TikTokPostingDeclaration', () => {
  it('without branded content links only the music confirmation', () => {
    const { container } = render(<TikTokPostingDeclaration brandedContent={false} />);
    expect(container.textContent).toBe(
      'Ao publicar, você concorda com a Confirmação de Uso de Música do TikTok.',
    );
    expect(screen.getByRole('link', { name: 'Confirmação de Uso de Música' })).toHaveAttribute(
      'href',
      MUSIC_USAGE_CONFIRMATION_URL,
    );
    expect(screen.queryByRole('link', { name: 'Política de Conteúdo de Marca' })).toBeNull();
  });

  it.each([true, undefined])('branded (%s) links both policies', (branded) => {
    const { container } = render(<TikTokPostingDeclaration brandedContent={branded} />);
    expect(container.textContent).toBe(
      'Ao publicar, você concorda com a Política de Conteúdo de Marca e a Confirmação de Uso de Música do TikTok.',
    );
    expect(screen.getByRole('link', { name: 'Política de Conteúdo de Marca' })).toHaveAttribute(
      'href',
      BRANDED_CONTENT_POLICY_URL,
    );
  });

  it('links open in a new tab safely', () => {
    render(<TikTokPostingDeclaration brandedContent={false} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
