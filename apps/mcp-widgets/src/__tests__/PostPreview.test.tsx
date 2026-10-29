import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import preview from '../__fixtures__/post_preview.json';
import over from '../__fixtures__/post_preview_over.json';
import reels from '../__fixtures__/post_preview_reels.json';
import { fakeHost, textResult } from './fakeHost';

describe('PostPreview', () => {
  it('renders the slides and the caption count against the limit', () => {
    render(<App host={fakeHost(preview)} />);
    const slides = screen.getByRole('list', { name: 'Lâminas' });
    expect(slides.querySelectorAll('li')).toHaveLength(5);
    expect(screen.getByText('Lâmina 1 de 5')).toBeInTheDocument();
    expect(screen.getByText(`${preview.caption_len} de 2.200 caracteres`)).toBeInTheDocument();
    expect(screen.getByText('Dra. Marina Arrais · pilar Educação')).toBeInTheDocument();
  });

  it('switches the big slide when a slide is picked', async () => {
    render(<App host={fakeHost(preview)} />);
    await userEvent.click(screen.getByRole('button', { name: /^3 FPS 100/ }));
    expect(screen.getByText('Lâmina 3 de 5')).toBeInTheDocument();
  });

  it('"Salvar como rascunho" calls create_post with the fixture fields', async () => {
    const host = fakeHost(preview, {
      results: {
        create_post: textResult({
          id: 901,
          titulo: preview.titulo,
          tipo: 'carrossel',
          status: 'rascunho',
        }),
      },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar como rascunho' }));
    expect(host.callTool).toHaveBeenCalledWith('create_post', {
      cliente_id: preview.client.id,
      titulo: preview.titulo,
      tipo: preview.tipo,
      body: preview.body,
      ig_caption: preview.ig_caption,
    });
    expect(await screen.findByText('Rascunho salvo no Mesaas.')).toBeInTheDocument();
  });

  it('a caption over caption_max shows the overflow and disables save (Review Focus 4)', async () => {
    const host = fakeHost(over);
    render(<App host={host} />);
    expect(screen.getByText(/Legenda acima do limite/)).toBeInTheDocument();
    const save = screen.getByRole('button', { name: 'Salvar alterações' });
    expect(save).toBeDisabled();
    await userEvent.click(save);
    expect(host.callTool).not.toHaveBeenCalled();
  });

  it('a saved post (post_id) saves with update_post, never sending tipo', async () => {
    const ok = { ...over, ig_caption: 'Curta.', caption_len: 6 };
    const host = fakeHost(ok, {
      results: {
        update_post: textResult({
          id: 901,
          titulo: ok.titulo,
          tipo: 'feed',
          status: 'revisao_interna',
        }),
      },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(host.callTool).toHaveBeenCalledWith('update_post', {
      post_id: 901,
      titulo: ok.titulo,
      body: ok.body,
      ig_caption: 'Curta.',
    });
  });

  it('a caption-only revision (body "") never sends body, so the saved content stays', async () => {
    const captionOnly = { ...over, ig_caption: 'Curta.', caption_len: 6, body: '' };
    const host = fakeHost(captionOnly, {
      results: {
        update_post: textResult({ id: 901, titulo: 'X', tipo: 'feed', status: 'rascunho' }),
      },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    const args = vi.mocked(host.callTool).mock.calls[0][1] as Record<string, unknown>;
    expect(args).toEqual({ post_id: 901, titulo: captionOnly.titulo, ig_caption: 'Curta.' });
    expect(Object.hasOwn(args, 'body')).toBe(false);
    expect(Object.hasOwn(args, 'tipo')).toBe(false);
  });

  it('a save error shows the server sentence, never the raw English fallback', async () => {
    const host = fakeHost(preview, {
      results: {
        create_post: {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: 'Internal error.' }) }],
        },
      },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Salvar como rascunho' }));
    expect(
      await screen.findByText('Não deu certo agora. Tente de novo em instantes.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Internal error/)).toBeNull();
  });

  it('reels render the roteiro', () => {
    render(<App host={fakeHost(reels)} />);
    expect(screen.getByText('Roteiro')).toBeInTheDocument();
    expect(screen.getByText(/a doutora mostra o índice UV/)).toBeInTheDocument();
  });

  it('"Ver opções de legenda" asks the chat; "Abrir no Mesaas" opens the client', async () => {
    const host = fakeHost(preview);
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver opções de legenda' }));
    expect(host.sendMessage).toHaveBeenCalledWith(
      'Mostrar opções de legenda para o post "5 mitos sobre protetor solar"',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Abrir no Mesaas' }));
    expect(host.openLink).toHaveBeenCalledWith('https://www.mesaas.com.br/clientes/42');
  });
});
