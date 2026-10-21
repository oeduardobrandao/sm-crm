import type { PostPlatform } from '@/store/posts';

/** Post publica no Instagram? `platform` nulo = linha antiga = default do banco (instagram). */
export function targetsInstagram(p: PostPlatform | null | undefined): boolean {
  return p == null || p === 'instagram' || p === 'both';
}

/** 'other' = nenhum destino com publicação automática (só Geral). Nada o agenda. */
export function hasAutoPublishTarget(p: PostPlatform | null | undefined): boolean {
  return p !== 'other';
}
