import { toast } from 'sonner';

/** Copies an absolute CRM deep link (current origin + relative path) to the clipboard. */
export async function copyAppLink(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    toast.success('Link copiado!');
  } catch {
    toast.error('Não foi possível copiar o link.');
  }
}
