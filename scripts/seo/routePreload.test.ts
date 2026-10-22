import { describe, expect, it } from 'vitest';
import {
  imagePreloadTag,
  preloadTagsFor,
  routePreloadTags,
  type BuildManifest,
} from './routePreload';

const manifest: BuildManifest = {
  'index.html': {
    file: 'assets/index-E.js',
    isEntry: true,
    imports: ['_shared-S.js'],
    css: ['assets/index-E.css'],
    dynamicImports: ['src/pages/landing/LandingPage.tsx'],
  },
  '_shared-S.js': { file: 'assets/shared-S.js', css: ['assets/shared-S.css'] },
  'src/pages/landing/LandingPage.tsx': {
    file: 'assets/LandingPage-L.js',
    imports: ['index.html', '_shared-S.js', '_landing-A.js', '_icon-I.js'],
    css: ['assets/LandingPage-L.css', 'assets/shared-S.css'],
    dynamicImports: ['src/pages/landing/Heavy.tsx'],
  },
  '_landing-A.js': {
    file: 'assets/landing-A.js',
    imports: ['index.html', '_icon-I.js'],
    css: ['assets/landing-A.css'],
  },
  '_icon-I.js': { file: 'assets/icon-I.js', imports: ['index.html'] },
  'src/pages/landing/Heavy.tsx': { file: 'assets/Heavy-H.js' },
};

describe('preloadTagsFor', () => {
  it('preloads the chunk, its transitive static imports and css, minus the entry graph', () => {
    const tags = preloadTagsFor(manifest, 'src/pages/landing/LandingPage.tsx');
    expect(tags.split('\n    ')).toEqual([
      '<link rel="stylesheet" crossorigin href="/assets/landing-A.css">',
      '<link rel="stylesheet" crossorigin href="/assets/LandingPage-L.css">',
      '<link rel="modulepreload" crossorigin href="/assets/LandingPage-L.js">',
      '<link rel="modulepreload" crossorigin href="/assets/landing-A.js">',
      '<link rel="modulepreload" crossorigin href="/assets/icon-I.js">',
    ]);
    expect(tags).not.toContain('Heavy');
    expect(tags).not.toContain('index-E');
    expect(tags).not.toContain('shared-S');
  });

  it('orders stylesheets dependencies first, as Vite inserts them at runtime', () => {
    // A -> B -> C: C's css must come before B's, and B's before A's, so the importing
    // chunk's rules win ties against the rules of what it imports.
    const chain: BuildManifest = {
      'index.html': { file: 'assets/index.js', isEntry: true },
      'src/A.tsx': { file: 'assets/A.js', imports: ['_B.js', '_C.js'], css: ['assets/A.css'] },
      '_B.js': { file: 'assets/B.js', imports: ['_C.js'], css: ['assets/B.css'] },
      '_C.js': { file: 'assets/C.js', css: ['assets/C.css'] },
    };
    const css = preloadTagsFor(chain, 'src/A.tsx')
      .split('\n    ')
      .filter((t) => t.includes('stylesheet'));
    expect(css).toEqual([
      '<link rel="stylesheet" crossorigin href="/assets/C.css">',
      '<link rel="stylesheet" crossorigin href="/assets/B.css">',
      '<link rel="stylesheet" crossorigin href="/assets/A.css">',
    ]);
  });

  it('throws when the chunk is missing from the manifest', () => {
    expect(() => preloadTagsFor(manifest, 'src/pages/Nope.tsx')).toThrow(
      'prerender: build manifest has no entry for src/pages/Nope.tsx',
    );
  });

  it('throws when an import points at a missing manifest entry', () => {
    const broken: BuildManifest = {
      ...manifest,
      '_landing-A.js': { file: 'assets/landing-A.js', imports: ['_gone.js'] },
    };
    expect(() => preloadTagsFor(broken, 'src/pages/landing/LandingPage.tsx')).toThrow('_gone.js');
  });
});

describe('routePreloadTags', () => {
  it('returns an empty string for routes without a mapped chunk', () => {
    expect(routePreloadTags(manifest, '/sobre')).toBe('');
  });

  it('throws for a mapped route whose chunk is missing', () => {
    expect(() => routePreloadTags(manifest, '/precos')).toThrow('PrecosPage');
  });
});

describe('imagePreloadTag', () => {
  it('emits a high-priority responsive image preload with escaped attributes', () => {
    expect(
      imagePreloadTag('/a.webp 760w, /b"&.webp 1200w', '(max-width: 720px) 100vw, 1140px'),
    ).toBe(
      '<link rel="preload" as="image" fetchpriority="high" imagesrcset="/a.webp 760w, /b&quot;&amp;.webp 1200w" imagesizes="(max-width: 720px) 100vw, 1140px">',
    );
  });
});
