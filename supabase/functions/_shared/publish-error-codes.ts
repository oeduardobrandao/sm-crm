// Classificação estável de erros de publicação do Instagram.
// A ORDEM das regras importa: a Meta devolve "reduce the amount of data"
// com graphCode 1, o mesmo código do erro transiente genérico.

export type PublishErrorCode =
  | "TOKEN_EXPIRED"
  | "MEDIA_TOO_LARGE"
  | "CAROUSEL_LIMIT"
  | "NO_MEDIA"
  | "MEDIA_UNSUPPORTED"
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
] as const;

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
