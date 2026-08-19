// Validação dos botões de link da DM (button template da Meta).
// Espelha o CHECK do banco (validate_ig_dm_buttons + limite de 640 chars em
// dm_message quando há botão) para o erro aparecer inline, nunca como 23514.
// Spec: docs/superpowers/specs/2026-08-19-instagram-dm-link-buttons-design.md
import type { DmButton } from '@/store';
import { sanitizeExternalUrl } from '@/utils/security';

export const MAX_DM_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
export const DM_MAX = 1000;
export const DM_MAX_WITH_BUTTONS = 640;
export const MAX_BUTTON_URL = 500;

const HTTP_URL_RE = /^https?:\/\//i;

export function dmMessageLimit(buttons: DmButton[]): number {
  return buttons.length > 0 ? DM_MAX_WITH_BUTTONS : DM_MAX;
}

// Devolve a chave i18n do primeiro erro (namespace `automations`) ou null.
// A URL exige `^https?://` PRIMEIRO (o que o banco exige; `example.com` sem
// esquema falha aqui, nunca no CHECK) e o sanitizer entra só como gate de
// segurança extra. O valor salvo é o digitado (trim), nunca o reescrito.
export function validateDmButtons(buttons: DmButton[], dmMessage: string): string | null {
  if (buttons.length > MAX_DM_BUTTONS) return 'form.validationButtonsMax';
  for (const b of buttons) {
    const title = b.title.trim();
    if (!title || title.length > MAX_BUTTON_TITLE) return 'form.validationButtonTitle';
    const url = b.url.trim();
    if (!HTTP_URL_RE.test(url) || url.length > MAX_BUTTON_URL || sanitizeExternalUrl(url) === '#') {
      return 'form.validationButtonUrl';
    }
  }
  if (buttons.length > 0 && dmMessage.trim().length > DM_MAX_WITH_BUTTONS) {
    return 'form.validationDmWithButtons';
  }
  return null;
}
