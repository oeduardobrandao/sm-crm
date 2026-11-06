import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../App';
import { fakeHost } from './fakeHost';
import preview from '../__fixtures__/post_preview.json';
import over from '../__fixtures__/post_preview_over.json';
import reels from '../__fixtures__/post_preview_reels.json';
import options from '../__fixtures__/caption_options.json';
import calendar from '../__fixtures__/client_calendar.json';
import attach from '../__fixtures__/attach_image.json';
import ineligible from '../__fixtures__/attach_image_ineligible.json';
import sendResult from '../__fixtures__/send_result.json';

const ALL = { preview, over, reels, options, calendar, attach, ineligible, sendResult };

describe('App', () => {
  it.each([
    ['unknown card', { card: 'agenda', v: 1 }],
    ['unknown version', { ...preview, v: 2 }],
    ['not an object', 'oi'],
  ])('%s renders "Atualize o conector"', (_name, data) => {
    render(<App host={fakeHost(data)} />);
    expect(screen.getByText('Atualize o conector')).toBeInTheDocument();
  });

  it('a malformed known card falls back instead of crashing', () => {
    render(<App host={fakeHost({ card: 'client_calendar', v: 1, client: null })} />);
    expect(screen.getByText('Atualize o conector')).toBeInTheDocument();
  });

  it('no data yet shows loading; an error result shows its sentence', () => {
    const { unmount } = render(<App host={fakeHost(undefined)} />);
    expect(screen.getByText(/Carregando o cartão/)).toBeInTheDocument();
    unmount();
    const host = { ...fakeHost(undefined), resultError: 'Cliente não encontrado neste workspace.' };
    render(<App host={host} />);
    expect(screen.getByText('Cliente não encontrado neste workspace.')).toBeInTheDocument();
  });

  it('send_result renders its outcome', () => {
    render(<App host={fakeHost(sendResult)} />);
    expect(screen.getByText('Este post já está com o cliente.')).toBeInTheDocument();
  });

  describe.each(Object.entries(ALL))('%s', (_name, data) => {
    it.each(['light', 'dark'] as const)('renders in %s with data-theme on the root', (theme) => {
      const { container } = render(<App host={fakeHost(data, { theme })} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root).toHaveClass('mw-root');
      expect(root).toHaveAttribute('data-theme', theme);
      expect(container.querySelector('.mw-card')).not.toBeNull();
      expect(screen.queryByText('Atualize o conector')).toBeNull();
    });

    it('no rendered string contains an em dash', () => {
      const { container } = render(<App host={fakeHost(data)} />);
      expect(container.innerHTML).not.toContain('—');
    });
  });
});
