// Classificação estável de erros de publicação do Instagram.
// A ORDEM das regras importa: a Meta devolve "reduce the amount of data"
// com graphCode 1, o mesmo código do erro transiente genérico.

export type PublishErrorCode =
  | "TOKEN_EXPIRED"
  | "MEDIA_TOO_LARGE"
  | "CAROUSEL_LIMIT"
  | "NO_MEDIA"
  | "MEDIA_UNSUPPORTED"
  | "TRIAL_INELIGIBLE"
  | "CONTAINER_EXPIRED"
  | "RATE_LIMIT"
  | "IG_TRANSIENT"
  | "INTERNAL"
  | "UNKNOWN";

/** Códigos que o auto-retry do cron não resolve: exigem ação do usuário. */
export const NON_RETRYABLE_CODES: readonly PublishErrorCode[] = [
  "TOKEN_EXPIRED",
  "MEDIA_TOO_LARGE",
  "CAROUSEL_LIMIT",
  "NO_MEDIA",
  "MEDIA_UNSUPPORTED",
  "TRIAL_INELIGIBLE",
] as const;

/** Lançada pelos guards de publicação quando um post com Reel de teste não é
 * exatamente um vídeo com tipo reels. O classificador abaixo casa com ela —
 * não reformular sem atualizar o padrão. */
export const TRIAL_MEDIA_SHAPE_ERROR =
  "Reel de teste exige exatamente um vídeo. Ajuste a mídia ou desligue o Reel de teste.";

const RATE_LIMIT_GRAPH_CODES = new Set([4, 9, 17, 32, 613]);
// 2207026 = formato de vídeo não suportado pela Meta.
const MEDIA_UNSUPPORTED_SUBCODES = new Set([2207026]);

interface ClassifiableError {
  message?: string;
  code?: string;
  graphCode?: number;
  graphSubcode?: number;
}

export function classifyPublishError(err: unknown): PublishErrorCode {
  const e = (err ?? {}) as ClassifiableError;
  const msg = (typeof e.message === "string" ? e.message : String(err ?? "")).toLowerCase();
  const graphCode = typeof e.graphCode === "number" ? e.graphCode : undefined;

  if (e.code === "TOKEN_EXPIRED" || graphCode === 190) return "TOKEN_EXPIRED";
  if (msg.includes("reduce the amount of data")) return "MEDIA_TOO_LARGE";
  if (
    msg.includes("carrossel do instagram aceita no máximo") ||
    msg.includes("too little or too many attachments")
  ) return "CAROUSEL_LIMIT";
  if (
    msg.includes("no media files found") ||
    msg.includes("stories require exactly one media file")
  ) return "NO_MEDIA";
  if (
    msg.includes("container failed processing") ||
    msg.includes("falhou no processamento do instagram") ||
    (typeof e.graphSubcode === "number" && MEDIA_UNSUPPORTED_SUBCODES.has(e.graphSubcode))
  ) return "MEDIA_UNSUPPORTED";
  // Tier 1 (determinístico): nossa própria guarda de formato de mídia.
  // Tier 2 (Meta: conta <1.000 seguidores etc.) só entra quando o erro real
  // for capturado em staging/prod — não inventar regex para wording da Meta;
  // até lá cai em UNKNOWN (comportamento definido no spec).
  if (msg.includes("reel de teste exige exatamente um vídeo")) return "TRIAL_INELIGIBLE";
  if (msg.includes("does not exist, cannot be loaded due to missing permissions")) {
    return "CONTAINER_EXPIRED";
  }
  if (graphCode !== undefined && RATE_LIMIT_GRAPH_CODES.has(graphCode)) return "RATE_LIMIT";
  if (graphCode === 1 || graphCode === 2 || msg.includes("retry your request later")) {
    return "IG_TRANSIENT";
  }
  if (
    msg.includes("ciphertext") ||
    msg.includes("tag length") ||
    msg.includes("mark_platform_published failed") ||
    msg.includes("record_post_status_change") ||
    msg.includes("failed to persist") ||
    msg.includes("failed to mark story post")
  ) return "INTERNAL";
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Copy acionável em PT para cada código — espelha o mapa do frontend
// (apps/crm/src/pages/entregas/publishErrorCopy.ts). Usado no email de alerta
// do cron para que o operador já saiba a causa e a ação sem abrir o CRM.
// ---------------------------------------------------------------------------

export interface PublishErrorDisplay {
  titulo: string;
  explicacao: string;
}

export const PUBLISH_ERROR_COPY: Record<PublishErrorCode, PublishErrorDisplay> = {
  TOKEN_EXPIRED: {
    titulo: "Conexão com o Instagram expirou",
    explicacao:
      "A autorização da conta do Instagram expirou ou foi revogada. Reconecte a conta na página do cliente e reagende o post.",
  },
  MEDIA_TOO_LARGE: {
    titulo: "Mídia muito pesada para o Instagram",
    explicacao:
      "O Instagram recusou o arquivo por tamanho. Imagens: até 8 MB. Vídeos: até 250 MB. Ajuste a mídia na galeria e tente novamente.",
  },
  CAROUSEL_LIMIT: {
    titulo: "Carrossel acima do limite do Instagram",
    explicacao:
      "A publicação via API aceita no máximo 10 itens por carrossel. Remova itens na galeria e tente novamente.",
  },
  NO_MEDIA: {
    titulo: "Post sem mídia anexada",
    explicacao:
      "O post foi agendado sem nenhuma imagem ou vídeo. Anexe a mídia na galeria e reagende.",
  },
  MEDIA_UNSUPPORTED: {
    titulo: "Instagram não conseguiu processar a mídia",
    explicacao:
      "O arquivo tem formato, proporção ou duração que o Instagram não aceita. Confira a mídia na galeria e tente novamente.",
  },
  TRIAL_INELIGIBLE: {
    titulo: "Reel de teste não aceito",
    explicacao:
      "O post precisa de exatamente um vídeo e a conta precisa ser profissional, pública e ter 1.000+ seguidores. Ajuste o post ou a conta, ou desligue o Reel de teste, e tente novamente.",
  },
  CONTAINER_EXPIRED: {
    titulo: "Publicação preparada expirou no Instagram",
    explicacao:
      "O Instagram descarta publicações preparadas que não são concluídas em 24 horas. Tente novamente para recomeçar do zero.",
  },
  RATE_LIMIT: {
    titulo: "Limite de publicações do Instagram atingido",
    explicacao:
      "O Instagram limita a quantidade de publicações via API em 24 horas por conta. Aguarde um pouco e tente novamente.",
  },
  IG_TRANSIENT: {
    titulo: "Instabilidade temporária do Instagram",
    explicacao:
      "O Instagram retornou um erro temporário. Normalmente funciona ao tentar novamente.",
  },
  INTERNAL: {
    titulo: "Erro interno ao publicar",
    explicacao:
      "Algo falhou do nosso lado, não é um problema do post nem da conta. Tente novamente e, se persistir, fale com o suporte informando o post.",
  },
  UNKNOWN: {
    titulo: "Falha na publicação",
    explicacao:
      "O Instagram retornou um erro não reconhecido. Tente novamente e, se persistir, fale com o suporte.",
  },
};

export function getPublishErrorDisplay(code: string | null | undefined): PublishErrorDisplay {
  if (code && code in PUBLISH_ERROR_COPY) {
    return PUBLISH_ERROR_COPY[code as PublishErrorCode];
  }
  return PUBLISH_ERROR_COPY.UNKNOWN;
}
