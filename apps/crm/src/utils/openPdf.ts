import { toast } from 'sonner';
import { hasMesaasNativeMethod } from '../native/mesaasNative';
import { shareNatively } from './downloadMedia';
import { openExternalUrl } from './security';

/**
 * Whether a PDF link should go to the app's share sheet instead of a new tab. In the
 * iOS app a new tab leaves the app for Safari (Capacitor opens every other origin
 * outside the web view); an app binary with the native download keeps the user in.
 */
export function opensPdfInApp(): boolean {
  return hasMesaasNativeMethod('shareFiles');
}

/** "Relatório Março 2026.pdf": a name the share sheet and Files can show. */
export function pdfFilename(title: string | null | undefined): string {
  const base = (title ?? '')
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base || 'relatorio'}.pdf`;
}

/**
 * Opens a generated PDF. In the iOS app the native side downloads it and opens the
 * share sheet (preview, Save to Files, Print, Mail...), which needs no fresh tap, so it
 * can run after an await. Elsewhere it opens a new tab, which must run inside a tap on
 * iOS Safari: callers on the web keep their own tap flow.
 */
export async function openPdf(url: string, filename: string): Promise<void> {
  if (opensPdfInApp()) {
    try {
      await shareNatively([{ url, filename }]);
    } catch {
      toast.error('Não foi possível abrir o PDF. Tente novamente.');
    }
    return;
  }
  openExternalUrl(url);
}

/**
 * onClick for an "Abrir PDF" `<a href target="_blank">`: the web keeps the link (a real
 * tap opens the tab), the iOS app takes the share sheet instead of leaving for Safari.
 */
export function pdfLinkClick(url: string, filename: string) {
  return (e: { preventDefault(): void }) => {
    if (!opensPdfInApp()) return;
    e.preventDefault();
    void openPdf(url, filename);
  };
}
