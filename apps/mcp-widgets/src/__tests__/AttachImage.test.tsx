import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import attach from '../__fixtures__/attach_image.json';
import ineligible from '../__fixtures__/attach_image_ineligible.json';
import { fakeHost, textResult } from './fakeHost';

describe('AttachImage', () => {
  it('defaults to the next empty slot and appends with replace false', async () => {
    const host = fakeHost(attach, { results: { attach_image_to_post: textResult({ ok: true }) } });
    render(<App host={host} />);
    expect(screen.getByRole('button', { name: 'Lâmina 4, vazia' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Anexar na lâmina escolhida' }));
    expect(host.callTool).toHaveBeenCalledWith('attach_image_to_post', {
      post_id: 777,
      image: attach.image,
      position: 4,
      replace: false,
    });
    expect(await screen.findByText('Imagem anexada na lâmina 4 no Mesaas.')).toBeInTheDocument();
  });

  it('a slide that has media asks "Substituir a imagem da lâmina N?" and sends replace true', async () => {
    const host = fakeHost(attach, { results: { attach_image_to_post: textResult({ ok: true }) } });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Lâmina 2, já tem imagem' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anexar na lâmina escolhida' }));
    expect(screen.getByText('Substituir a imagem da lâmina 2?')).toBeInTheDocument();
    expect(host.callTool).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Substituir' }));
    expect(host.callTool).toHaveBeenCalledWith('attach_image_to_post', {
      post_id: 777,
      image: attach.image,
      position: 2,
      replace: true,
    });
  });

  it('after a successful attach, picking another slot cannot attach the same image again', async () => {
    const host = fakeHost(attach, { results: { attach_image_to_post: textResult({ ok: true }) } });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anexar na lâmina escolhida' }));
    expect(await screen.findByText('Imagem anexada na lâmina 4 no Mesaas.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Lâmina 1, já tem imagem' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anexar na lâmina escolhida' }));
    expect(screen.queryByRole('button', { name: 'Substituir' })).toBeNull();
    expect(host.callTool).toHaveBeenCalledTimes(1);
  });

  it('an ineligible post shows the reason and no attach button', () => {
    render(<App host={fakeHost(ineligible)} />);
    expect(screen.getByText(ineligible.reason)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Anexar na lâmina escolhida' })).toBeNull();
  });

  it('"Escolher outra imagem" only on hosts with a file picker', async () => {
    const { unmount } = render(<App host={fakeHost(attach)} />);
    expect(screen.queryByRole('button', { name: 'Escolher outra imagem' })).toBeNull();
    unmount();
    const picked = { download_url: 'https://files.example/new', file_id: 'file-new' };
    const host = fakeHost(attach, {
      pickImage: async () => picked,
      results: { attach_image_to_post: textResult({ ok: true }) },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Escolher outra imagem' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anexar na lâmina escolhida' }));
    expect(host.callTool).toHaveBeenCalledWith(
      'attach_image_to_post',
      expect.objectContaining({ image: picked }),
    );
  });
});
