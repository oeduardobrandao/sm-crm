import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '../App';
import { planSteps } from '../cards/AttachImages';
import multi from '../__fixtures__/attach_images.json';
import { fakeHost, textResult } from './fakeHost';
import type { AttachImageData } from '../types';

const data = multi as unknown as AttachImageData;
const ok = (args: Record<string, unknown>) =>
  textResult({
    ok: true,
    position: args.position,
    url: `https://media.example/${args.position}.png`,
  });
const calls = (host: ReturnType<typeof fakeHost>) =>
  (host.callTool as ReturnType<typeof vi.fn>).mock.calls.map(
    (c) => c[1] as Record<string, unknown>,
  );

const withMedia = (n: number) => ({
  ...data,
  media: Array.from({ length: n }, (_, i) => ({
    position: i + 1,
    url: data.media[0].url,
    link_id: 600 + i,
  })),
});

describe('planSteps', () => {
  const imgs = data.images!;
  it('append: after the current slides, each with the count it expects before it', () => {
    expect(
      planSteps(imgs, data.media, 'append').map((s) => [s.position, s.replace, s.expected_count]),
    ).toEqual([
      [4, false, 3],
      [5, false, 4],
      [6, false, 5],
    ]);
  });
  it('replace with fewer images: replaces in place by link id, the last one trims', () => {
    const steps = planSteps(imgs.slice(0, 2), data.media, 'replace');
    expect(steps.map((s) => [s.position, s.replace, s.expected_link_id, s.trim_after])).toEqual([
      [1, true, 501, false],
      [2, true, 502, true],
    ]);
  });
  it('replace with more images: replaces every slide, appends the rest, no trim', () => {
    const four = [
      ...imgs,
      { download_url: 'https://files.oaiusercontent.com/d', file_id: 'file-d' },
    ];
    const steps = planSteps(four, data.media, 'replace');
    expect(
      steps.map((s) => [s.position, s.replace, s.expected_link_id, s.expected_count, s.trim_after]),
    ).toEqual([
      [1, true, 501, undefined, false],
      [2, true, 502, undefined, false],
      [3, true, 503, undefined, false],
      [4, false, undefined, 3, false],
    ]);
  });
});

describe('AttachImages', () => {
  it('two or more images open the multi card, numbered after the current slides', () => {
    render(<App host={fakeHost(data)} />);
    expect(screen.getByRole('button', { name: 'Anexar 3 imagens' })).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'Imagens do chat' });
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((li) => li.textContent?.trim().charAt(0)),
    ).toEqual(['4', '5', '6']);
    expect(screen.getByText('O post fica com 6 slides.')).toBeInTheDocument();
  });

  it('arrows reorder, and the attach follows the new order', async () => {
    const host = fakeHost(data, { results: { attach_image_to_post: ok } });
    render(<App host={host} />);
    await userEvent.click(
      screen.getByRole('button', { name: 'Mover a imagem do slide 4 para a direita' }),
    );
    expect(
      screen.getByRole('button', { name: 'Mover a imagem do slide 4 para a esquerda' }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Anexar 3 imagens' }));
    await screen.findByText('3 imagens anexadas no Mesaas, nos slides 4 a 6.');
    expect(
      calls(host).map((a) => [
        (a.image as { file_id: string }).file_id,
        a.position,
        a.expected_count,
      ]),
    ).toEqual([
      ['file-b', 4, 3],
      ['file-a', 5, 4],
      ['file-c', 6, 5],
    ]);
  });

  it('done: shows how the post ended, new slides marked, and opens the post', async () => {
    const host = fakeHost(data, { results: { attach_image_to_post: ok } });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anexar 3 imagens' }));
    const final = await screen.findByRole('list', { name: 'Slides do post' });
    expect(within(final).getAllByRole('listitem')).toHaveLength(6);
    expect(within(final).getAllByText('Nova')).toHaveLength(3);
    expect(final.querySelectorAll('img')[5]).toHaveAttribute('src', 'https://media.example/6.png');
    await userEvent.click(screen.getByRole('button', { name: /Abrir no Mesaas/ }));
    expect(host.openLink).toHaveBeenCalledWith('https://www.mesaas.com.br/entregas?post=777');
  });

  it('replace mode: in place by link id, the last image trims the old slides after it', async () => {
    const host = fakeHost(
      { ...data, images: data.images!.slice(0, 2) },
      { results: { attach_image_to_post: ok } },
    );
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('radio', { name: /Substituir os slides atuais/ }));
    expect(
      screen.getByText('Os 3 slides atuais saem do post e ele fica com 2.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Substituir por 2 imagens' }));
    await screen.findByText('2 imagens anexadas no Mesaas, nos slides 1 a 2.');
    expect(
      calls(host).map((a) => [a.position, a.replace, a.expected_link_id, a.trim_after]),
    ).toEqual([
      [1, true, 501, undefined],
      [2, true, 502, true],
    ]);
  });

  it('over 10 slides in append mode: says so and blocks the button', () => {
    render(<App host={fakeHost(withMedia(9))} />);
    expect(
      screen.getByText('O post aceita até 10 slides. Escolha Substituir ou mande até 1 imagens.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anexar 3 imagens' })).toBeDisabled();
  });

  it('stops at the first failure and "Tentar de novo" resumes from that image', async () => {
    let fail = true;
    const host = fakeHost(data, {
      results: {
        attach_image_to_post: (args) => {
          if (args.position === 5 && fail) {
            fail = false;
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: '{"error":"Não foi possível baixar esta imagem. Envie de novo pelo chat."}',
                },
              ],
            };
          }
          return ok(args);
        },
      },
    });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anexar 3 imagens' }));
    expect(
      await screen.findByText('1 de 3 imagens anexadas. A 2ª não entrou.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Não foi possível baixar esta imagem. Envie de novo pelo chat.'),
    ).toBeInTheDocument();
    expect(calls(host)).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo (2 imagens)' }));
    await screen.findByText('3 imagens anexadas no Mesaas, nos slides 4 a 6.');
    expect(calls(host).map((a) => a.position)).toEqual([4, 5, 5, 6]);
  });

  it('asks the host for a fresh link before each image, and keeps the original when it cannot', async () => {
    const refreshImageUrl = vi.fn(async (id: string) =>
      id === 'file-b' ? null : `https://fresh.example/${id}`,
    );
    const host = fakeHost(data, { results: { attach_image_to_post: ok }, refreshImageUrl });
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anexar 3 imagens' }));
    await screen.findByText('3 imagens anexadas no Mesaas, nos slides 4 a 6.');
    expect(calls(host).map((a) => (a.image as { download_url: string }).download_url)).toEqual([
      'https://fresh.example/file-a',
      data.images![1].download_url,
      'https://fresh.example/file-c',
    ]);
  });

  it('one image keeps the slide picker, now telling the server what it saw', async () => {
    const host = fakeHost(
      { ...data, images: [data.images![0]] },
      { results: { attach_image_to_post: ok } },
    );
    render(<App host={host} />);
    await userEvent.click(screen.getByRole('button', { name: 'Anexar no slide escolhido' }));
    expect(calls(host)[0]).toMatchObject({ position: 4, replace: false, expected_count: 3 });
  });
});
