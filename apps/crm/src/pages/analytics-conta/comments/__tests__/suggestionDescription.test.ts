import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import ptComments from '../../../../../../../packages/i18n/locales/pt/analyticsComments.json';
import enComments from '../../../../../../../packages/i18n/locales/en/analyticsComments.json';
import { suggestionDescription } from '../SuggestionIdeaButton';

i18n.addResourceBundle('pt', 'analyticsComments', ptComments, true, true);
i18n.addResourceBundle('en', 'analyticsComments', enComments, true, true);

describe('suggestionDescription', () => {
  const idea = { titulo: 't', descricao: 'Desc', motivo: 'porque' };
  const tPt = i18n.getFixedT('pt', 'analyticsComments');
  const tEn = i18n.getFixedT('en', 'analyticsComments');

  it('usa o rótulo com preposição própria, sem "de os"', () => {
    expect(suggestionDescription(idea, 'dos últimos 30 dias', tPt)).toBe(
      'Desc\n\nOrigem: comentários dos últimos 30 dias (porque)',
    );
    expect(suggestionDescription(idea, 'da imagem de 3 nov', tPt)).toContain(
      'comentários da imagem de 3 nov',
    );
  });

  it('traduz a origem para inglês', () => {
    expect(suggestionDescription(idea, 'from the last 30 days', tEn)).toBe(
      'Desc\n\nSource: comments from the last 30 days (porque)',
    );
  });
});
