import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('initial bundle boundaries', () => {
  it('loads Hub and Admin route pages lazily', () => {
    const hub = source('../apps/hub/src/router.tsx');
    const admin = source('../apps/admin/src/router.tsx');

    expect(hub).not.toMatch(/import .* from ['"]\.\/pages\//);
    expect(admin).not.toMatch(/import .* from ['"]\.\/pages\//);
    expect(hub.match(/lazy:\s*async/g)?.length).toBeGreaterThanOrEqual(11);
    expect(admin.match(/lazy:\s*async/g)?.length).toBeGreaterThanOrEqual(9);
  });

  it('keeps optional CRM banners out of the initial app-layout chunk', () => {
    const layout = source('../apps/crm/src/components/layout/AppLayout.tsx');
    expect(layout).toContain("lazy(() => import('./GlobalBannerContainer'))");
    expect(layout).toContain('<Suspense fallback={null}>');
  });
});
