import { describe, expect, it } from 'vitest';
import { suggestionDescription } from '../SuggestionIdeaButton';

describe('suggestionDescription', () => {
  const idea = { titulo: 't', descricao: 'Desc', motivo: 'porque' };

  it('usa o rótulo com preposição própria, sem "de os"', () => {
    expect(suggestionDescription(idea, 'dos últimos 30 dias')).toBe(
      'Desc\n\nOrigem: comentários dos últimos 30 dias (porque)',
    );
    expect(suggestionDescription(idea, 'da imagem de 3 nov')).toContain(
      'comentários da imagem de 3 nov',
    );
  });
});
