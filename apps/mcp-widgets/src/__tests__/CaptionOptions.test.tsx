import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import options from '../__fixtures__/caption_options.json';
import { fakeHost, textResult } from './fakeHost';

describe('CaptionOptions', () => {
  it('an option click selects it', async () => {
    render(<App host={fakeHost(options)} />);
    const second = screen.getByRole('button', { name: /Opção 2 · Pergunta direta/ });
    expect(second).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(second);
    expect(second).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Opção 1 · Didática/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('"Usar esta legenda" with post_id calls update_post with the picked text', async () => {
    const host = fakeHost(options, {
      results: { update_post: textResult({ id: 777, status: 'rascunho' }) },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: /Opção 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Usar esta legenda' }));
    expect(host.callTool).toHaveBeenCalledWith('update_post', {
      post_id: 777,
      ig_caption: options.options[1].text,
    });
    expect(await screen.findByText('Legenda da opção 2 salva no post.')).toBeInTheDocument();
  });

  it('"Usar esta legenda" without post_id sends "Usar a opção 2" to the chat', async () => {
    const { post_id: _omit, ...noPost } = options;
    const host = fakeHost(noPost);
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: /Opção 2/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Usar esta legenda' }));
    expect(host.sendMessage).toHaveBeenCalledWith('Usar a opção 2');
    expect(host.callTool).not.toHaveBeenCalled();
  });

  it('shows each option length', () => {
    render(<App host={fakeHost(options)} />);
    expect(screen.getByText(`${options.options[2].len} caracteres`)).toBeInTheDocument();
  });
});
