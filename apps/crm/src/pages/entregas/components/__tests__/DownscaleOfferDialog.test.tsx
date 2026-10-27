import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DownscaleOfferDialog, type DownscaleOfferItem } from '../DownscaleOfferDialog';

const plan = {
  width: 1080,
  height: 1920,
  resized: true,
  bitrate: 8_000_000,
  maxBytes: 300 * 2 ** 20,
  durationSeconds: 60,
};

function item(over: Partial<DownscaleOfferItem> = {}): DownscaleOfferItem {
  return {
    key: 'a',
    name: 'clip.mov',
    width: 2160,
    height: 3840,
    sizeBytes: 752 * 2 ** 20,
    plan,
    reasons: ['width', 'size'],
    support: { engine: 'webcodecs', hdr: false },
    overClientCap: false,
    ...over,
  };
}

function setup(items: DownscaleOfferItem[]) {
  const cb = { onReduce: vi.fn(), onSendOriginal: vi.fn(), onDismiss: vi.fn() };
  render(<DownscaleOfferDialog open items={items} {...cb} />);
  return cb;
}

describe('DownscaleOfferDialog', () => {
  it('título singular e plural por contagem', () => {
    const { unmount } = render(
      <DownscaleOfferDialog
        open
        items={[item()]}
        onReduce={vi.fn()}
        onSendOriginal={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('Vídeo acima do limite do Instagram')).toBeInTheDocument();
    unmount();
    setup([item(), item({ key: 'b', name: 'b.mov' })]);
    expect(screen.getByText('2 vídeos acima do limite do Instagram')).toBeInTheDocument();
  });

  it('mostra nome, dimensões, tamanho, alvo e motivos', () => {
    setup([item()]);
    expect(screen.getByText('clip.mov')).toBeInTheDocument();
    expect(
      screen.getByText(
        (_, el) => el?.tagName === 'P' && el.textContent === '2160×3840 · 752 MB → 1080×1920',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Largura acima de 1920 px/)).toBeInTheDocument();
    expect(screen.getByText(/Acima de 300 MB/)).toBeInTheDocument();
  });

  it('nota de motor lento aparece uma vez com ffmpeg', () => {
    setup([
      item({ support: { engine: 'ffmpeg', hdr: false } }),
      item({ key: 'b', name: 'b.mov', support: { engine: 'ffmpeg', hdr: false } }),
    ]);
    expect(screen.getAllByText(/conversão é mais lenta/)).toHaveLength(1);
  });

  it('notas por item: unsupported, tooLong, hdr, overClientCap', () => {
    setup([
      item({ key: 'u', name: 'u.mov', support: { engine: 'none', hdr: false } }),
      item({ key: 't', name: 't.mov', plan: null }),
      item({ key: 'h', name: 'h.mov', support: { engine: 'webcodecs', hdr: true } }),
      item({ key: 'o', name: 'o.mov', overClientCap: true }),
    ]);
    expect(screen.getByText(/não consegue reduzir um vídeo/)).toBeInTheDocument();
    expect(screen.getByText('Vídeo longo demais para caber no limite.')).toBeInTheDocument();
    expect(screen.getByText(/Vídeo em HDR/)).toBeInTheDocument();
    expect(screen.getByText(/Arquivo acima de 2 GB/)).toBeInTheDocument();
  });

  it('Enviar original desabilitado quando todos passam de 2 GB', () => {
    setup([item({ overClientCap: true }), item({ key: 'b', overClientCap: true })]);
    expect(screen.getByRole('button', { name: 'Enviar original' })).toBeDisabled();
  });

  it('Reduzir desabilitado enquanto inspeciona ou sem item convertível', () => {
    const { unmount } = render(
      <DownscaleOfferDialog
        open
        items={[item(), item({ key: 'b', support: null })]}
        onReduce={vi.fn()}
        onSendOriginal={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reduzir e enviar' })).toBeDisabled();
    unmount();
    setup([item({ plan: null }), item({ key: 'b', support: { engine: 'none', hdr: false } })]);
    expect(screen.getByRole('button', { name: 'Reduzir e enviar' })).toBeDisabled();
  });

  it('botões e fechar chamam os callbacks', () => {
    const cb = setup([item()]);
    fireEvent.click(screen.getByRole('button', { name: 'Reduzir e enviar' }));
    expect(cb.onReduce).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Enviar original' }));
    expect(cb.onSendOriginal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(cb.onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Esc chama onDismiss', () => {
    const cb = setup([item()]);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(cb.onDismiss).toHaveBeenCalled();
  });
});
