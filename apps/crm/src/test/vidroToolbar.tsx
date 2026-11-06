import type { ReactNode } from 'react';
import { PageToolbarProvider } from '@/components/layout/PageToolbarContext';
import PageToolbar from '@/components/layout/PageToolbar';

/** Renders a page inside the Vidro toolbar context, as AppLayout does at >=1101px with the flag on. */
export function VidroToolbarHarness({
  children,
  vidroShell = true,
}: {
  children: ReactNode;
  vidroShell?: boolean;
}) {
  return (
    <PageToolbarProvider vidroShell={vidroShell}>
      {vidroShell && <PageToolbar capsule={null} />}
      {children}
    </PageToolbarProvider>
  );
}
