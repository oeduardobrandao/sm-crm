import { describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import type { TFunction } from 'i18next';
import { PostReferenceError } from '../../../../services/postReferences';
import { referenceErrorCode, referenceErrorMessage } from '../referenceErrors';
import {
  formatDuration,
  formatMegabytes,
  formatReferenceWhen,
  referenceTitle,
} from '../referenceFormat';

const t = i18n.getFixedT('pt', 'hubPosts') as unknown as TFunction<'hubPosts'>;
const MB = 1024 * 1024;

describe('referenceErrorMessage', () => {
  it('uses the spec copy for every code', () => {
    expect(referenceErrorMessage('too_large', t, { fileKind: 'video', sizeBytes: 230 * MB })).toBe(
      'O vídeo tem 230 MB e o limite é 200 MB. Envie uma versão menor ou um link.',
    );
    expect(referenceErrorMessage('too_large', t, { fileKind: 'image', sizeBytes: 30 * MB })).toBe(
      'A foto tem 30 MB e o limite é 25 MB. Envie uma versão menor ou um link.',
    );
    expect(
      referenceErrorMessage('too_large', t, { fileKind: 'document', sizeBytes: 26 * MB }),
    ).toBe('O PDF tem 26 MB e o limite é 25 MB. Envie uma versão menor ou um link.');
    expect(referenceErrorMessage('unsupported_type', t)).toBe(
      'Esse tipo de arquivo não é aceito. Envie foto, vídeo ou PDF.',
    );
    expect(referenceErrorMessage('reference_limit', t)).toBe(
      'Este post já tem 10 referências. Remova uma para adicionar outra.',
    );
    expect(referenceErrorMessage('quota_exceeded', t)).toBe(
      'Não foi possível enviar agora: o espaço de arquivos da agência acabou. Avise a equipe.',
    );
    expect(referenceErrorMessage('post_not_pending', t)).toBe(
      'Este post não está mais aguardando sua aprovação.',
    );
    expect(referenceErrorMessage('invalid_url', t)).toBe(
      'Informe um endereço completo, como exemplo.com.br.',
    );
    for (const code of ['internal', 'upload_mismatch', 'thumbnail_invalid'] as const) {
      expect(referenceErrorMessage(code, t)).toBe('Algo deu errado. Tente novamente.');
    }
  });

  it('never returns an em dash', () => {
    const codes = [
      'unsupported_type',
      'too_large',
      'thumbnail_invalid',
      'reference_limit',
      'quota_exceeded',
      'post_not_pending',
      'invalid_url',
      'invalid_note',
      'not_found',
      'locked',
      'rate_limited',
      'upload_mismatch',
      'internal',
    ] as const;
    for (const code of codes) expect(referenceErrorMessage(code, t)).not.toMatch(/—/);
  });

  it('reads the code off a PostReferenceError and treats anything else as internal', () => {
    expect(referenceErrorCode(new PostReferenceError('locked'))).toBe('locked');
    expect(referenceErrorCode(new Error('boom'))).toBe('internal');
  });
});

describe('reference formatting', () => {
  it('formats sizes in MB with one decimal under 10 MB', () => {
    expect(formatMegabytes(2.4 * MB, 'pt-BR')).toBe('2,4 MB');
    expect(formatMegabytes(38 * MB, 'pt-BR')).toBe('38 MB');
    expect(formatMegabytes(0, 'pt-BR')).toBe('0 MB');
  });

  it('formats durations', () => {
    expect(formatDuration(32)).toBe('0:32');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('says hoje / ontem for recent references', () => {
    const now = new Date(2026, 9, 8, 18, 0);
    expect(formatReferenceWhen(new Date(2026, 9, 8, 14, 32).toISOString(), 'pt-BR', t, now)).toBe(
      'hoje, 14:32',
    );
    expect(formatReferenceWhen(new Date(2026, 9, 7, 9, 5).toISOString(), 'pt-BR', t, now)).toBe(
      'ontem, 09:05',
    );
  });

  it('titles a link by its title, then its domain', () => {
    const base = {
      id: 1,
      kind: 'link' as const,
      file_kind: null,
      name: null,
      mime_type: null,
      size_bytes: null,
      duration_seconds: null,
      width: null,
      height: null,
      url: null,
      thumbnail_url: null,
      blur_data_url: null,
      download_url: null,
      link_url: 'https://exemplo.com/p',
      link_title: null,
      link_domain: 'exemplo.com',
      note: null,
      post_approval_id: null,
      created_at: '2026-10-08T12:00:00Z',
      can_remove: true,
    };
    expect(referenceTitle(base)).toBe('exemplo.com');
    expect(referenceTitle({ ...base, link_title: 'Post da marca' })).toBe('Post da marca');
  });
});
