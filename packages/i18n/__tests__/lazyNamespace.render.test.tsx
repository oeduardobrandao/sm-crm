import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '../index';

function PostsTitle() {
  const { t } = useTranslation('posts');
  return <h1>{t('title')}</h1>;
}

function CommonHello() {
  const { t } = useTranslation();
  return <p>{t('hello')}</p>;
}

describe('a component using a lazy namespace', () => {
  it('suspends until its bundle loads, while bundled namespaces render at once', async () => {
    const instance = i18next.createInstance();
    let resolvePosts!: (data: Record<string, unknown>) => void;
    const load = vi.fn(
      (_lng: string, ns: string) =>
        new Promise<Record<string, unknown>>((resolve) => {
          if (ns === 'posts') resolvePosts = resolve;
        }),
    );
    initI18n(
      { pt: { common: { hello: 'Olá' } }, en: { common: { hello: 'Hello' } } },
      { instance, lazy: { namespaces: ['posts'], load } },
    );

    render(
      <I18nextProvider i18n={instance}>
        <CommonHello />
        <Suspense fallback={<span>loading</span>}>
          <PostsTitle />
        </Suspense>
      </I18nextProvider>,
    );

    expect(screen.getByText('Olá')).toBeInTheDocument();
    expect(screen.getByText('loading')).toBeInTheDocument();

    resolvePosts({ title: 'Postagens' });

    expect(await screen.findByRole('heading', { name: 'Postagens' })).toBeInTheDocument();
  });
});
