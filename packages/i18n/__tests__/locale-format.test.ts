import { format } from 'date-fns';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getDateFnsLocale,
  getIntlLocale,
  i18n,
  initI18n,
  intlLocaleFor,
  STORAGE_KEY,
} from '../index';
import ptCommon from '../locales/pt/common.json';
import enCommon from '../locales/en/common.json';

describe('locale helpers', () => {
  afterEach(async () => {
    localStorage.removeItem(STORAGE_KEY);
    await i18n.changeLanguage('pt');
  });

  it('maps languages to Intl tags, defaulting to pt-BR', () => {
    expect(intlLocaleFor(undefined)).toBe('pt-BR');
    expect(intlLocaleFor('pt')).toBe('pt-BR');
    expect(intlLocaleFor('en')).toBe('en-US');
    expect(intlLocaleFor('EN-gb')).toBe('en-US');
  });

  it('reads the current language at call time', async () => {
    initI18n({ pt: { common: ptCommon }, en: { common: enCommon } });
    await i18n.changeLanguage('pt');
    expect(getIntlLocale()).toBe('pt-BR');
    expect(getDateFnsLocale().code).toBe('pt-BR');
    await i18n.changeLanguage('en');
    expect(getIntlLocale()).toBe('en-US');
    expect(getDateFnsLocale().code).toBe('en-US');
  });

  it('weekdayDayMonth pattern renders per language', async () => {
    initI18n({ pt: { common: ptCommon }, en: { common: enCommon } });
    const d = new Date(2026, 9, 21);
    await i18n.changeLanguage('pt');
    expect(format(d, i18n.t('dateFormat.weekdayDayMonth'), { locale: getDateFnsLocale() })).toBe(
      'quarta-feira, 21 de outubro',
    );
    await i18n.changeLanguage('en');
    expect(format(d, i18n.t('dateFormat.weekdayDayMonth'), { locale: getDateFnsLocale() })).toBe(
      'Wednesday, October 21',
    );
  });
});
