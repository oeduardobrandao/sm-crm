import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppearancePopover } from '../AppearancePopover';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const layout = (over: Partial<ReportLayout> = {}): ReportLayout => ({
  version: 1,
  blocks: [],
  ...over,
});

describe('AppearancePopover', () => {
  it('abre com temas, fontes e cor; seleciona tema', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Editorial/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'editorial' }));
  });

  it('clicar num tema não selecionado nunca remove a chave (theme sempre presente após o clique)', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Bold/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'bold' }));
  });

  it('clicar em "Padrão" remove o tema (volta a herdar)', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ theme: 'clean' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Padrão/ }));
    const next = onChange.mock.calls[0][0];
    expect('theme' in next).toBe(false);
  });

  it('clicar na fonte ja selecionada volta a herdar (remove a chave)', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ fonts: 'fraunces' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Fraunces/ }));
    const next = onChange.mock.calls[0][0];
    expect('fonts' in next).toBe(false);
  });

  it('clicar numa fonte diferente da atual define o novo valor', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ fonts: 'system' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Space Grotesk/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fonts: 'grotesk' }));
  });

  it('"usar cor da marca" so aparece com override e remove o accent', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ accent: '#123456' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('button', { name: 'usar cor da marca' }));
    const next = onChange.mock.calls[0][0];
    expect('accent' in next).toBe(false);
  });

  it('sem override de accent, o botão "usar cor da marca" não aparece', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    expect(screen.queryByRole('button', { name: 'usar cor da marca' })).not.toBeInTheDocument();
  });

  it('clicar em "Hub" seleciona o tema hub', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Hub/ }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'hub' }));
  });

  it('a miniatura do Hub carrega accent e bg de superfície nas custom properties', () => {
    const onChange = vi.fn();
    render(
      <AppearancePopover
        layout={layout({ accent: '#123456' })}
        snapshot={makeSnapshotFixture()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Aparência/ }));
    const thumb = screen
      .getByRole('radio', { name: /Hub/ })
      .querySelector('.rb-appearance-thumb') as HTMLElement;
    expect(thumb.style.getPropertyValue('--rb-hub-thumb-accent')).toBe('#123456');
    expect(thumb.style.getPropertyValue('--rb-hub-thumb-bg')).toBe('#FAFAFA');
  });
});
