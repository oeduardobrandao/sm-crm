import { describe, expect, it } from 'vitest';
import { describeAudioError, normalizeAudioMime, validateAudioBlob } from '../validation';

describe('audio validation (shared)', () => {
  it('normalizes and validates', () => {
    expect(normalizeAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAudioMime('video/mp4')).toBeNull();
    expect(() => validateAudioBlob(new Blob([]), 'audio/webm')).toThrow('Gravação vazia');
    expect(validateAudioBlob(new Blob(['abc']), 'audio/mp4')).toBe('audio/mp4');
  });

  it('maps ideia_not_found to a reload message and keeps the briefing mappings', () => {
    expect(describeAudioError(new Error('ideia_not_found'), 'x')).toBe(
      'Esta ideia não está mais disponível. Recarregue a página.',
    );
    expect(describeAudioError(new Error('Ideia não encontrada.'), 'x')).toBe(
      'Esta ideia não está mais disponível. Recarregue a página.',
    );
    expect(describeAudioError(new Error('quota_exceeded'), 'x')).toBe(
      'O espaço de armazenamento do plano acabou. Fale com a agência para liberar espaço.',
    );
    expect(describeAudioError(new Error('question_not_found'), 'x')).toBe(
      'Esta pergunta não está mais disponível. Recarregue a página.',
    );
  });
});
