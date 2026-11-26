import i18n from 'i18next';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EnglishPage } from '../EnglishPage';

describe('EnglishPage', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('pt');
  });

  it('mounts and switches to English even when storage writes throw', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() =>
      render(
        <EnglishPage>
          <p>hello</p>
        </EnglishPage>,
      ),
    ).not.toThrow();
    expect(screen.getByText('hello')).toBeInTheDocument();
    await vi.waitFor(() => expect(i18n.language).toBe('en'));
  });
});
