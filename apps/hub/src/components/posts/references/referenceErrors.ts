import type { TFunction } from 'i18next';
import { PostReferenceError } from '../../../services/postReferences';
import type { ReferenceErrorCode, ReferenceFileKind } from '../../../types/postReferences';

export function referenceErrorCode(err: unknown): ReferenceErrorCode {
  return err instanceof PostReferenceError ? err.code : 'internal';
}

/** Inline copy for every reference error (rendered with role="alert"). */
export function referenceErrorMessage(
  code: ReferenceErrorCode,
  t: TFunction<'hubPosts'>,
  ctx: { fileKind?: ReferenceFileKind; sizeBytes?: number } = {},
): string {
  switch (code) {
    case 'too_large': {
      if (ctx.sizeBytes == null || !ctx.fileKind) {
        return t(
          'references.errors.tooLarge',
          'O arquivo passa do limite: fotos e PDFs até 25 MB, vídeos até 200 MB.',
        );
      }
      const size = Math.ceil(ctx.sizeBytes / (1024 * 1024));
      if (ctx.fileKind === 'video') {
        return t(
          'references.errors.tooLargeVideo',
          'O vídeo tem {{size}} MB e o limite é 200 MB. Envie uma versão menor ou um link.',
          { size },
        );
      }
      if (ctx.fileKind === 'image') {
        return t(
          'references.errors.tooLargeImage',
          'A foto tem {{size}} MB e o limite é 25 MB. Envie uma versão menor ou um link.',
          { size },
        );
      }
      return t(
        'references.errors.tooLargeDocument',
        'O PDF tem {{size}} MB e o limite é 25 MB. Envie uma versão menor ou um link.',
        { size },
      );
    }
    case 'unsupported_type':
      return t(
        'references.errors.unsupportedType',
        'Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
      );
    case 'reference_limit':
      return t(
        'references.errors.referenceLimit',
        'Este post já tem 10 referências. Remova uma para adicionar outra.',
      );
    case 'quota_exceeded':
      return t(
        'references.errors.quotaExceeded',
        'Não foi possível enviar agora: o espaço de arquivos da agência acabou. Avise a equipe.',
      );
    case 'post_not_pending':
      return t(
        'references.errors.postNotPending',
        'Este post não está mais aguardando sua aprovação.',
      );
    case 'invalid_url':
      return t(
        'references.errors.invalidUrl',
        'Informe um endereço válido, começando com http ou https.',
      );
    case 'invalid_note':
      return t('references.errors.invalidNote', 'A nota pode ter até 500 caracteres.');
    case 'locked':
      return t(
        'references.errors.locked',
        'A equipe já recebeu esta referência. Ela não pode mais ser alterada.',
      );
    case 'not_found':
      return t('references.errors.notFound', 'Esta referência não está mais disponível.');
    case 'rate_limited':
      return t(
        'references.errors.rateLimited',
        'Muitas tentativas seguidas. Aguarde um minuto e tente novamente.',
      );
    default:
      return t('references.errors.generic', 'Algo deu errado. Tente novamente.');
  }
}
