// Copy acionável em PT para cada código de falha de publicação.
// Espelha o enum de supabase/functions/_shared/publish-error-codes.ts.
// Regra da casa: sem em-dash em copy de UI.

export type PublishErrorCode =
  | 'TOKEN_EXPIRED'
  | 'MEDIA_TOO_LARGE'
  | 'CAROUSEL_LIMIT'
  | 'NO_MEDIA'
  | 'MEDIA_UNSUPPORTED'
  | 'CONTAINER_EXPIRED'
  | 'RATE_LIMIT'
  | 'IG_TRANSIENT'
  | 'INTERNAL'
  | 'UNKNOWN';

export type PublishErrorAction = 'reconnect' | 'retry' | 'media' | 'support';

export interface PublishErrorDisplay {
  titulo: string;
  explicacao: string;
  acao: PublishErrorAction;
  /** false esconde o publish_error cru (ex.: INTERNAL expõe detalhe nosso). */
  mostrarDetalhes: boolean;
}

export const PUBLISH_ERROR_COPY: Record<PublishErrorCode, PublishErrorDisplay> = {
  TOKEN_EXPIRED: {
    titulo: 'Conexão com o Instagram expirou',
    explicacao:
      'A autorização da conta do Instagram expirou ou foi revogada. Reconecte a conta na página do cliente e reagende o post.',
    acao: 'reconnect',
    mostrarDetalhes: false,
  },
  MEDIA_TOO_LARGE: {
    titulo: 'Mídia muito pesada para o Instagram',
    explicacao:
      'O Instagram recusou o arquivo por tamanho. Imagens: até 8 MB. Vídeos: até 250 MB. Ajuste a mídia na galeria e tente novamente.',
    acao: 'media',
    mostrarDetalhes: true,
  },
  CAROUSEL_LIMIT: {
    titulo: 'Carrossel acima do limite do Instagram',
    explicacao:
      'A publicação via API aceita no máximo 10 itens por carrossel. Remova itens na galeria e tente novamente.',
    acao: 'media',
    mostrarDetalhes: true,
  },
  NO_MEDIA: {
    titulo: 'Post sem mídia anexada',
    explicacao:
      'O post foi agendado sem nenhuma imagem ou vídeo. Anexe a mídia na galeria e reagende.',
    acao: 'media',
    mostrarDetalhes: false,
  },
  MEDIA_UNSUPPORTED: {
    titulo: 'Instagram não conseguiu processar a mídia',
    explicacao:
      'O arquivo tem formato, proporção ou duração que o Instagram não aceita. Confira a mídia na galeria e tente novamente.',
    acao: 'media',
    mostrarDetalhes: true,
  },
  CONTAINER_EXPIRED: {
    titulo: 'Publicação preparada expirou no Instagram',
    explicacao:
      'O Instagram descarta publicações preparadas que não são concluídas em 24 horas. Tente novamente para recomeçar do zero.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
  RATE_LIMIT: {
    titulo: 'Limite de publicações do Instagram atingido',
    explicacao:
      'O Instagram limita a quantidade de publicações via API em 24 horas por conta. Aguarde um pouco e tente novamente.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
  IG_TRANSIENT: {
    titulo: 'Instabilidade temporária do Instagram',
    explicacao:
      'O Instagram retornou um erro temporário. Normalmente funciona ao tentar novamente.',
    acao: 'retry',
    mostrarDetalhes: true,
  },
  INTERNAL: {
    titulo: 'Erro interno ao publicar',
    explicacao:
      'Algo falhou do nosso lado, não é um problema do post nem da conta. Tente novamente e, se persistir, fale com o suporte informando o post.',
    acao: 'support',
    mostrarDetalhes: false,
  },
  UNKNOWN: {
    titulo: 'Falha na publicação',
    explicacao:
      'O Instagram retornou um erro não reconhecido. Tente novamente e, se persistir, fale com o suporte.',
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
