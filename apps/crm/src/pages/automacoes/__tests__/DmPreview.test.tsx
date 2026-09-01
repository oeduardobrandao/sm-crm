import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DmPreview from '../DmPreview';

// t devolve a CHAVE (padrão AutomacoesPage.test): asserts sobre chaves do
// namespace automations, não strings pt/en.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'pt' },
  }),
}));

describe('DmPreview', () => {
  it('renderiza o texto e os botões com título', () => {
    render(
      <DmPreview
        clientName="Dra. Marina"
        clientSigla="DM"
        clientCor="#3ecf8e"
        text="Escolha uma opção:"
        buttons={[
          { title: 'Agendar', url: 'https://agenda.x' },
          { title: 'WhatsApp', url: 'https://wa.me/55' },
          { title: '  ', url: 'https://vazio.x' },
        ]}
      />,
    );
    expect(screen.getByText('Escolha uma opção:')).toBeInTheDocument();
    const agendar = screen.getByRole('link', { name: 'Agendar' });
    expect(agendar).toHaveAttribute('href', 'https://agenda.x');
    expect(agendar).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'WhatsApp' })).toBeInTheDocument();
    // botão com título vazio não aparece
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.getByText('Dra. Marina')).toBeInTheDocument();
    // monograma usa a sigla/cor reais do cadastro, não hash do nome; aparece
    // duas vezes (cabeçalho da conversa + bolha da mensagem)
    const monograms = screen.getAllByText('DM');
    expect(monograms).toHaveLength(2);
    for (const m of monograms) {
      expect(m).toHaveStyle({ background: '#3ecf8e' });
    }
    expect(screen.queryByText('form.previewEmpty')).not.toBeInTheDocument();
  });

  it('estado vazio mostra o placeholder e nenhum balão', () => {
    render(<DmPreview clientName={null} text="  " buttons={[]} />);
    expect(screen.getByText('form.previewEmpty')).toBeInTheDocument();
    expect(screen.queryByTestId('dm-preview-bubble')).not.toBeInTheDocument();
  });

  it('URL perigosa é neutralizada no href do preview', () => {
    render(
      <DmPreview
        clientName="C"
        text="oi"
        buttons={[{ title: 'Zap', url: 'javascript:alert(1)' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Zap' })).toHaveAttribute('href', '#');
  });

  it('com mídia renderiza o cartão: imagem, título, subtítulo e botão', () => {
    render(
      <DmPreview
        clientName="Dra. Marina"
        text="Promoção de agosto"
        buttons={[{ title: 'Comprar', url: 'https://loja.x' }]}
        mediaUrl="blob:x"
        subtitle="Vagas limitadas"
      />,
    );
    const card = screen.getByTestId('dm-preview-card');
    const img = card.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'blob:x');
    expect(screen.getByText('Promoção de agosto')).toBeInTheDocument();
    expect(screen.getByText('Vagas limitadas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Comprar' })).toBeInTheDocument();
    expect(screen.getByText('form.previewCardFallbackNote')).toBeInTheDocument();
  });
});
