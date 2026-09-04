import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PopupCard, defaultSecondaryLabel, type PopupCardProps } from '../PopupCard';

const pages = [
  { title: 'Um', body: 'corpo **um**', eyebrow: 'Novo' },
  { title: 'Dois', body: 'corpo dois' },
  { title: 'Três', body: 'veja [o guia](https://x.y/guia)' },
];

function renderCard(over: Partial<PopupCardProps> = {}) {
  const props: PopupCardProps = {
    pages,
    page: 0,
    onPageChange: vi.fn(),
    ctaLabel: 'Ver',
    ctaStyle: 'ink',
    secondaryLabel: 'Agora não',
    requireAck: false,
    sanitizeHref: (h) => (h.startsWith('https://') ? h : '#'),
    onCta: vi.fn(),
    onSecondary: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { ...render(<PopupCard {...props} />), props };
}

describe('defaultSecondaryLabel', () => {
  it('Entendi com confirmação, Agora não com CTA, Fechar sem nada', () => {
    expect(defaultSecondaryLabel(true, true)).toBe('Entendi');
    expect(defaultSecondaryLabel(true, false)).toBe('Entendi');
    expect(defaultSecondaryLabel(false, true)).toBe('Agora não');
    expect(defaultSecondaryLabel(false, false)).toBe('Fechar');
  });
});

describe('PopupCard navegação por posição', () => {
  it('primeira página: só Próximo, sem Voltar, sem CTA; eyebrow com "1 de 3"', () => {
    renderCard();
    expect(screen.getByText('Novo · 1 de 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agora não' })).toBeNull();
  });

  it('página do meio: Voltar e Próximo chamam onPageChange; sem eyebrow mostra só "2 de 3"', () => {
    const { props } = renderCard({ page: 1 });
    expect(screen.getByText('2 de 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ver' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Agora não' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(props.onPageChange).toHaveBeenCalledWith(0);
    fireEvent.click(screen.getByRole('button', { name: 'Próximo' }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it('última página: Voltar, CTA e secundário; sem Próximo', () => {
    const { props } = renderCard({ page: 2 });
    expect(screen.getByRole('button', { name: 'Voltar' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Próximo' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver' }));
    expect(props.onCta).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
    expect(props.onSecondary).toHaveBeenCalled();
  });

  it('página única: sem pontinhos, sem contador, CTA + secundário', () => {
    renderCard({ pages: [pages[0]], page: 0 });
    expect(screen.queryByRole('button', { name: /Página 1 de/ })).toBeNull();
    expect(screen.getByText('Novo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver' })).toBeInTheDocument();
  });

  it('pontinhos trocam de página e marcam a atual', () => {
    const { props } = renderCard({ page: 0 });
    const dot3 = screen.getByRole('button', { name: 'Página 3 de 3' });
    fireEvent.click(dot3);
    expect(props.onPageChange).toHaveBeenCalledWith(2);
    expect(screen.getByRole('button', { name: 'Página 1 de 3' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});

describe('PopupCard fechar, confirmação e conteúdo', () => {
  it('X chama onClose; some com requireAck', () => {
    const { props, unmount } = renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(props.onClose).toHaveBeenCalled();
    unmount();
    renderCard({ requireAck: true, page: 2, ctaLabel: null, secondaryLabel: 'Entendi' });
    expect(screen.queryByRole('button', { name: 'Fechar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Entendi' })).toBeInTheDocument();
  });

  it('renderiza markdown e sanitiza links', () => {
    renderCard({ page: 2 });
    const link = screen.getByRole('link', { name: 'o guia' });
    expect(link).toHaveAttribute('href', 'https://x.y/guia');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('imagem só quando imageUrl existe; titleId e bodyId aplicados', () => {
    // A imagem é decorativa (alt=""), então não tem role "img": consulte o DOM direto.
    const { container } = renderCard({
      pages: [{ ...pages[0], imageUrl: 'https://img/x.png' }],
      titleId: 't1',
      bodyId: 'b1',
    });
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://img/x.png');
    expect(document.getElementById('t1')?.textContent).toBe('Um');
    expect(document.getElementById('b1')).not.toBeNull();
  });

  it('pages vazio não renderiza nada nem lança', () => {
    const { container } = renderCard({ pages: [], page: 0 });
    expect(container).toBeEmptyDOMElement();
  });
});
