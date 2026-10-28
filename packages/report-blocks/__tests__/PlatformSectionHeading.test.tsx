import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { PlatformIcon } from '../PlatformIcon';
import { PlatformSectionHeading } from '../blocks/PlatformSectionHeading';
import { PLATFORM_NAMES } from '../platform';
import { makeSnapshotFixture } from '../fixtures';
import type { ReportSection, SectionPlatform } from '../types';

function platformSection(
  platform: SectionPlatform,
  extra: Record<string, unknown> = {},
): ReportSection {
  return {
    marker: { id: `s_${platform}`, type: 'section', size: 'full', config: { platform, ...extra } },
    kind: platform,
    blocks: [],
    synthesized: false,
  };
}

describe('PlatformIcon', () => {
  it('ícone lucide decorativo por plataforma', () => {
    const { container: ig } = render(<PlatformIcon platform="instagram" size={20} />);
    const { container: tt } = render(<PlatformIcon platform="tiktok" className="x" />);
    const igSvg = ig.querySelector('svg')!;
    const ttSvg = tt.querySelector('svg')!;
    expect(igSvg.getAttribute('aria-hidden')).toBe('true');
    expect(ttSvg.getAttribute('aria-hidden')).toBe('true');
    expect(igSvg.getAttribute('width')).toBe('20');
    expect(igSvg.classList.contains('lucide-instagram')).toBe(true);
    expect(ttSvg.classList.contains('lucide-music-2')).toBe(true);
    expect(ttSvg.classList.contains('x')).toBe(true);
  });
});

describe('PlatformSectionHeading', () => {
  it('Instagram: item de grid largura cheia com ícone, nome e @handle', () => {
    const { container } = render(
      <PlatformSectionHeading
        section={platformSection('instagram')}
        snapshot={makeSnapshotFixture()}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe('rb-full rb-platform-heading');
    expect(root.dataset.sectionId).toBe('s_instagram');
    expect(root.hasAttribute('data-block-id')).toBe(false);
    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('h2')?.textContent).toBe(PLATFORM_NAMES.instagram);
    expect(root.textContent).toContain('@dra.exemplo');
  });

  it('TikTok: handle da conta do TikTok; title vence o nome', () => {
    const { container } = render(
      <PlatformSectionHeading
        section={platformSection('tiktok', { title: 'Vídeos curtos' })}
        snapshot={makeSnapshotFixture()}
      />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('Vídeos curtos');
    expect(container.textContent).toContain('@seucliente');
    expect(container.textContent).not.toContain('@dra.exemplo');
  });

  it('TikTok sem snapshot.tiktok: sem handle (nunca o do Instagram)', () => {
    const { container } = render(
      <PlatformSectionHeading
        section={platformSection('tiktok')}
        snapshot={makeSnapshotFixture({ tiktok: null })}
      />,
    );
    expect(container.querySelector('h2')?.textContent).toBe('TikTok');
    expect(container.textContent).not.toContain('@');
  });
});
