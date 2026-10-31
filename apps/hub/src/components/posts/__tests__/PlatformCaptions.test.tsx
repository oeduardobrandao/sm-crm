import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlatformCaptions } from '../PlatformCaptions';

afterEach(cleanup);

const TEXT = 'text-[14px]';

describe('PlatformCaptions', () => {
  it('one destination: just the caption, no label or switcher', () => {
    render(
      <PlatformCaptions
        groups={[{ platforms: ['tiktok'], text: 'Só TikTok' }]}
        textClassName={TEXT}
      />,
    );
    expect(screen.getByText('Só TikTok')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByText(/Mesma legenda/)).toBeNull();
  });

  it('same caption on several destinations: one block with a label', () => {
    render(
      <PlatformCaptions
        groups={[{ platforms: ['instagram', 'tiktok'], text: 'Igual' }]}
        textClassName={TEXT}
      />,
    );
    expect(screen.getByText('Mesma legenda para Instagram e TikTok')).toBeTruthy();
    expect(screen.getByText('Igual')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('different captions: one tab per group, switching with click and arrows', () => {
    render(
      <PlatformCaptions
        groups={[
          { platforms: ['instagram'], text: 'Do Instagram' },
          { platforms: ['tiktok'], text: 'Do TikTok' },
          { platforms: ['geral'], text: 'Da Geral' },
        ]}
        textClassName={TEXT}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Instagram', 'TikTok', 'Geral']);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Do Instagram')).toBeTruthy();
    expect(screen.queryByText('Do TikTok')).toBeNull();

    fireEvent.click(tabs[1]);
    expect(screen.getByText('Do TikTok')).toBeTruthy();

    fireEvent.keyDown(screen.getAllByRole('tab')[1], { key: 'ArrowRight' });
    expect(screen.getByText('Da Geral')).toBeTruthy();
    expect(screen.getByText(/não é publicada automaticamente/)).toBeTruthy();

    fireEvent.keyDown(screen.getAllByRole('tab')[2], { key: 'ArrowRight' });
    expect(screen.getByText('Do Instagram')).toBeTruthy();
  });

  it('an empty caption reads "Sem legenda"', () => {
    render(
      <PlatformCaptions
        groups={[
          { platforms: ['instagram'], text: 'IG' },
          { platforms: ['tiktok'], text: '' },
        ]}
        textClassName={TEXT}
      />,
    );
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByText('Sem legenda')).toBeTruthy();
  });
});
