import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { SendFlow } from '../cards/SendFlow';
import preview from '../__fixtures__/post_preview.json';
import { fakeHost, textResult } from './fakeHost';

const saved = { id: 901, titulo: preview.titulo, tipo: 'carrossel', status: 'rascunho' };

function savedHost(sendOutcome?: string, nonce: string | null = 'nonce-abc') {
  return fakeHost(preview, {
    results: {
      create_post: textResult(saved, nonce ? { 'mesaas/sendNonce': nonce } : undefined),
      send_post_to_client: {
        content: [{ type: 'text', text: 'ok' }],
        structuredContent: {
          card: 'send_result',
          v: 1,
          post_id: 901,
          outcome: sendOutcome ?? 'sent',
        },
      },
    },
  });
}

async function saveDraft() {
  await userEvent.click(screen.getByRole('button', { name: 'Salvar como rascunho' }));
}

describe('SendFlow', () => {
  it('after save shows "Enviar para aprovação"; confirm calls send_post_to_client with the nonce', async () => {
    const host = savedHost('sent');
    render(<App host={host} />);
    await saveDraft();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));

    expect(screen.getByText('Enviar para Dra. Marina Arrais aprovar?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
    expect(host.callTool).not.toHaveBeenCalledWith('send_post_to_client', expect.anything());

    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    expect(host.callTool).toHaveBeenCalledWith('send_post_to_client', {
      post_id: 901,
      expected_status: 'rascunho',
      nonce: 'nonce-abc',
    });
    expect(await screen.findByText('Post enviado ao cliente para aprovação.')).toBeInTheDocument();
    expect(screen.getByText('Enviado ao cliente')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar para aprovação' })).toBeNull();
  });

  it('"Cancelar" goes back without sending', async () => {
    const host = savedHost();
    render(<App host={host} />);
    await saveDraft();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Enviar para aprovação' })).toBeInTheDocument();
    expect(host.callTool).toHaveBeenCalledTimes(1);
  });

  it('outcome already_sent shows its message', async () => {
    render(<App host={savedHost('already_sent')} />);
    await saveDraft();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    expect(await screen.findByText('Este post já está com o cliente.')).toBeInTheDocument();
  });

  it.each([
    ['approved', 'O cliente já aprovou este post.'],
    ['failed', 'A publicação deste post falhou. Resolva no Mesaas antes de enviar de novo.'],
    ['stale', 'O post mudou no Mesaas. Atualize o cartão.'],
  ])('outcome %s shows its message', async (outcome, text) => {
    render(<App host={savedHost(outcome)} />);
    await saveDraft();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it('a refused send (expired card) shows the server sentence', async () => {
    const host = fakeHost(preview, {
      results: {
        create_post: textResult(saved, { 'mesaas/sendNonce': 'n' }),
        send_post_to_client: {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  'Este cartão expirou. Peça ao agente para mostrar o post de novo e salve de novo.',
              }),
            },
          ],
        },
      },
    });
    render(<App host={host} />);
    await saveDraft();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    expect(
      await screen.findByText(
        'Este cartão expirou. Peça ao agente para mostrar o post de novo e salve de novo.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar para aprovação' })).toBeNull();
  });

  it('any other refused send keeps "Enviar para aprovação" for a retry', async () => {
    const host = fakeHost(preview, {
      results: {
        create_post: textResult(saved, { 'mesaas/sendNonce': 'n' }),
        send_post_to_client: {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error: 'Este vídeo está sem capa. Adicione a capa no Mesaas antes de enviar.',
              }),
            },
          ],
        },
      },
    });
    render(<App host={host} />);
    await saveDraft();
    await userEvent.click(await screen.findByRole('button', { name: 'Enviar para aprovação' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    expect(
      await screen.findByText(
        'Este vídeo está sem capa. Adicione a capa no Mesaas antes de enviar.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Enviar para aprovação' }));
    await userEvent.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
    expect(host.callTool).toHaveBeenCalledTimes(3);
  });

  it('without a nonce in the save result _meta hides "Enviar para aprovação" and offers "Abrir no Mesaas"', async () => {
    const host = savedHost('sent', null);
    render(<App host={host} />);
    await saveDraft();
    expect(await screen.findByText('Rascunho salvo no Mesaas.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir no Mesaas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enviar para aprovação' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Abrir no Mesaas' }));
    expect(host.openLink).toHaveBeenCalledWith('https://www.mesaas.com.br/entregas?post=901');
  });

  it('rendered alone without a nonce: no send button', () => {
    render(
      <SendFlow
        host={fakeHost(undefined)}
        post={{ id: 5, titulo: 'X', tipo: 'feed', status: 'rascunho' }}
        client={{ id: 1, nome: 'Cliente' }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Enviar para aprovação' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Abrir no Mesaas' })).toBeInTheDocument();
  });

  it('a status the tool does not accept hides the send button even with a nonce', () => {
    render(
      <SendFlow
        host={fakeHost(undefined)}
        post={{ id: 5, titulo: 'X', tipo: 'feed', status: 'enviado_cliente' }}
        client={{ id: 1, nome: 'Cliente' }}
        nonce="n"
      />,
    );
    expect(screen.queryByRole('button', { name: 'Enviar para aprovação' })).toBeNull();
  });
});
