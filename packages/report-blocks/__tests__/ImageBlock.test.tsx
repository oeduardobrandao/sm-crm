import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ImageBlock } from '../blocks/ImageBlock';
import { blockHasData } from '../data-presence';
import { frameWidth, imageAspect, readImageConfig } from '../image';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportBlock } from '../types';

const img = (config?: Record<string, unknown>): ReportBlock => ({
  id: 'i',
  type: 'image',
  size: 'full',
  ...(config ? { config } : {}),
});

describe('readImageConfig / imageAspect', () => {
  it('defaults: original, cover, centro', () => {
    const c = readImageConfig(undefined);
    expect(c).toMatchObject({
      ratio: 'original',
      fit: 'cover',
      focal: { x: 0.5, y: 0.5 },
      src: null,
    });
  });
  it('original usa width/height; sem dimensões cai em 3:2', () => {
    expect(imageAspect(readImageConfig({ width: 800, height: 1000 }))).toBeCloseTo(0.8);
    expect(imageAspect(readImageConfig({}))).toBeCloseTo(1.5);
    expect(imageAspect(readImageConfig({ ratio: '9:16' }))).toBeCloseTo(9 / 16);
  });
  it('frameWidth limita a altura a 560px', () => {
    expect(frameWidth(16 / 9)).toBe(`min(100%, ${Math.round(560 * (16 / 9))}px)`);
    expect(frameWidth(9 / 16)).toBe('min(100%, 315px)');
  });
  it('valores inválidos voltam ao padrão', () => {
    const c = readImageConfig({ ratio: 'x', fit: 'y', focal: { x: 7, y: 'a' }, caption: 3 });
    expect(c).toMatchObject({
      ratio: 'original',
      fit: 'cover',
      focal: { x: 0.5, y: 0.5 },
      caption: '',
    });
  });
});

describe('ImageBlock', () => {
  it('sem src renderiza nada', () => {
    const { container } = render(
      <ImageBlock
        block={img({ file_id: 1, width: 10, height: 10 })}
        snapshot={makeSnapshotFixture()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('src javascript: é ignorado', () => {
    const { container } = render(
      <ImageBlock block={img({ src: 'javascript:alert(1)' })} snapshot={makeSnapshotFixture()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('aplica proporção, ajuste, enquadramento e legenda; sem lazy loading', () => {
    render(
      <ImageBlock
        block={img({
          src: 'https://cdn/x.png',
          file_id: 1,
          width: 1000,
          height: 1000,
          ratio: '16:9',
          fit: 'contain',
          focal: { x: 0, y: 1 },
          caption: 'Legenda',
          alt: 'Equipe',
        })}
        snapshot={makeSnapshotFixture()}
      />,
    );
    const el = screen.getByRole('img', { name: 'Equipe' }) as HTMLImageElement;
    expect(el.getAttribute('loading')).toBeNull();
    // jsdom's cssstyle may drop aspect-ratio/min(); assert the pure helpers
    // (see frameWidth/imageAspect tests) and only the props jsdom keeps.
    expect(el.style.objectFit).toBe('contain');
    expect(el.style.objectPosition).toBe('0% 100%');
    expect(screen.getByText('Legenda').tagName).toBe('FIGCAPTION');
    expect(el.closest('figure')!.className).toContain('rb-image');
  });

  it('alt vazio vira imagem decorativa (alt="")', () => {
    const { container } = render(
      <ImageBlock block={img({ src: 'blob:abc' })} snapshot={makeSnapshotFixture()} />,
    );
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('');
  });
});

describe('blockHasData(image)', () => {
  it('vazio = sem dados; com file_id = com dados', () => {
    expect(blockHasData(img(), makeSnapshotFixture())).toBe(false);
    expect(blockHasData(img({ file_id: 1, width: 1, height: 1 }), makeSnapshotFixture())).toBe(
      true,
    );
  });
});
