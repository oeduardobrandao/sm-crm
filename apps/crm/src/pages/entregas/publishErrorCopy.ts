import { i18n } from '@mesaas/i18n';

// Copy acionável em PT para cada código de falha de publicação.
// Espelha o enum de supabase/functions/_shared/publish-error-codes.ts.
// Regra da casa: sem em-dash em copy de UI.

export type PublishErrorCode =
  | 'TOKEN_EXPIRED'
  | 'MEDIA_TOO_LARGE'
  | 'CAROUSEL_LIMIT'
  | 'NO_MEDIA'
  | 'MEDIA_UNSUPPORTED'
  | 'TRIAL_INELIGIBLE'
  | 'CAPTION_TOO_LONG'
  | 'COLLABORATOR_INVALID'
  | 'ACCOUNT_RESTRICTED'
  | 'CONTAINER_EXPIRED'
  | 'RATE_LIMIT'
  | 'IG_TRANSIENT'
  | 'INTERNAL'
  | 'UNKNOWN';

export type PublishErrorAction = 'reconnect' | 'retry' | 'media' | 'support' | 'collaborators';

export interface PublishErrorDisplay {
  titulo: string;
  explicacao: string;
  acao: PublishErrorAction;
  /** false esconde o publish_error cru (ex.: INTERNAL expõe detalhe nosso). */
  mostrarDetalhes: boolean;
}

export const PUBLISH_ERROR_COPY: Record<PublishErrorCode, PublishErrorDisplay> = {
  TOKEN_EXPIRED: {
    get titulo() {
      return i18n.t('entregas:publishError.TOKEN_EXPIRED.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.TOKEN_EXPIRED.explicacao');
    },
    acao: 'reconnect',
    mostrarDetalhes: false,
  },
  MEDIA_TOO_LARGE: {
    get titulo() {
      return i18n.t('entregas:publishError.MEDIA_TOO_LARGE.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.MEDIA_TOO_LARGE.explicacao');
    },
    acao: 'media',
    mostrarDetalhes: true,
  },
  CAROUSEL_LIMIT: {
    get titulo() {
      return i18n.t('entregas:publishError.CAROUSEL_LIMIT.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.CAROUSEL_LIMIT.explicacao');
    },
    acao: 'media',
    mostrarDetalhes: true,
  },
  NO_MEDIA: {
    get titulo() {
      return i18n.t('entregas:publishError.NO_MEDIA.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.NO_MEDIA.explicacao');
    },
    acao: 'media',
    mostrarDetalhes: false,
  },
  MEDIA_UNSUPPORTED: {
    get titulo() {
      return i18n.t('entregas:publishError.MEDIA_UNSUPPORTED.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.MEDIA_UNSUPPORTED.explicacao');
    },
    acao: 'media',
    mostrarDetalhes: true,
  },
  TRIAL_INELIGIBLE: {
    get titulo() {
      return i18n.t('entregas:publishError.TRIAL_INELIGIBLE.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.TRIAL_INELIGIBLE.explicacao');
    },
    acao: 'retry',
    mostrarDetalhes: false,
  },
  CAPTION_TOO_LONG: {
    get titulo() {
      return i18n.t('entregas:publishError.CAPTION_TOO_LONG.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.CAPTION_TOO_LONG.explicacao');
    },
    acao: 'media',
    mostrarDetalhes: true,
  },
  COLLABORATOR_INVALID: {
    get titulo() {
      return i18n.t('entregas:publishError.COLLABORATOR_INVALID.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.COLLABORATOR_INVALID.explicacao');
    },
    acao: 'collaborators',
    mostrarDetalhes: false,
  },
  ACCOUNT_RESTRICTED: {
    get titulo() {
      return i18n.t('entregas:publishError.ACCOUNT_RESTRICTED.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.ACCOUNT_RESTRICTED.explicacao');
    },
    acao: 'retry',
    mostrarDetalhes: true,
  },
  CONTAINER_EXPIRED: {
    get titulo() {
      return i18n.t('entregas:publishError.CONTAINER_EXPIRED.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.CONTAINER_EXPIRED.explicacao');
    },
    acao: 'retry',
    mostrarDetalhes: true,
  },
  RATE_LIMIT: {
    get titulo() {
      return i18n.t('entregas:publishError.RATE_LIMIT.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.RATE_LIMIT.explicacao');
    },
    acao: 'retry',
    mostrarDetalhes: true,
  },
  IG_TRANSIENT: {
    get titulo() {
      return i18n.t('entregas:publishError.IG_TRANSIENT.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.IG_TRANSIENT.explicacao');
    },
    acao: 'retry',
    mostrarDetalhes: true,
  },
  INTERNAL: {
    get titulo() {
      return i18n.t('entregas:publishError.INTERNAL.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.INTERNAL.explicacao');
    },
    acao: 'support',
    mostrarDetalhes: false,
  },
  UNKNOWN: {
    get titulo() {
      return i18n.t('entregas:publishError.UNKNOWN.titulo');
    },
    get explicacao() {
      return i18n.t('entregas:publishError.UNKNOWN.explicacao');
    },
    acao: 'retry',
    mostrarDetalhes: true,
  },
};

export function getPublishErrorDisplay(code: string | null | undefined): PublishErrorDisplay {
  if (code && code in PUBLISH_ERROR_COPY) {
    return PUBLISH_ERROR_COPY[code as PublishErrorCode];
  }
  return PUBLISH_ERROR_COPY.UNKNOWN;
}
