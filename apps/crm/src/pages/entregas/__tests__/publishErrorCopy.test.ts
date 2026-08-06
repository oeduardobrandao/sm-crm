import { describe, it, expect } from 'vitest';
import {
  PUBLISH_ERROR_COPY,
  getPublishErrorDisplay,
  type PublishErrorCode,
} from '../publishErrorCopy';

const ALL_CODES: PublishErrorCode[] = [
  'TOKEN_EXPIRED', 'MEDIA_TOO_LARGE', 'CAROUSEL_LIMIT', 'NO_MEDIA',
  'MEDIA_UNSUPPORTED', 'CONTAINER_EXPIRED', 'RATE_LIMIT', 'IG_TRANSIENT',
  'INTERNAL', 'UNKNOWN',
];

describe('publishErrorCopy', () => {
  it('todo código tem copy completa', () => {
    for (const code of ALL_CODES) {
      const d = PUBLISH_ERROR_COPY[code];
      expect(d.titulo.length, code).toBeGreaterThan(0);
      expect(d.explicacao.length, code).toBeGreaterThan(0);
      expect(['reconnect', 'retry', 'media', 'support']).toContain(d.acao);
    }
  });

  it('nenhuma copy contém em-dash', () => {
    for (const code of ALL_CODES) {
      const d = PUBLISH_ERROR_COPY[code];
      expect(d.titulo, code).not.toMatch(/—/);
      expect(d.explicacao, code).not.toMatch(/—/);
    }
  });

  it('INTERNAL não expõe detalhes técnicos', () => {
    expect(PUBLISH_ERROR_COPY.INTERNAL.mostrarDetalhes).toBe(false);
    expect(PUBLISH_ERROR_COPY.INTERNAL.acao).toBe('support');
  });

  it('código nulo ou desconhecido cai em UNKNOWN', () => {
    expect(getPublishErrorDisplay(null)).toEqual(PUBLISH_ERROR_COPY.UNKNOWN);
    expect(getPublishErrorDisplay(undefined)).toEqual(PUBLISH_ERROR_COPY.UNKNOWN);
    expect(getPublishErrorDisplay('CODIGO_FUTURO')).toEqual(PUBLISH_ERROR_COPY.UNKNOWN);
  });

  it('TOKEN_EXPIRED direciona para reconexão', () => {
    expect(PUBLISH_ERROR_COPY.TOKEN_EXPIRED.acao).toBe('reconnect');
  });
});
