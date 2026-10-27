import { afterEach, describe, expect, it } from 'vitest';
import { i18n } from '@mesaas/i18n';
import {
  eventoFormSchema,
  motivoSerie,
  opcoesMensaisPersonalizadas,
  regraParaPersonalizada,
  rotuloDtstart,
  valoresIniciaisCriar,
  validarPersonalizada,
  type EventoFormValues,
} from '../eventoFormSchema';

const SEG_5 = new Date(2026, 9, 5);

function valores(p: Partial<EventoFormValues> = {}): EventoFormValues {
  return {
    ...valoresIniciaisCriar({
      inicio: new Date(2026, 9, 5, 14, 0),
      fim: new Date(2026, 9, 5, 16, 0),
      diaInteiro: false,
    }),
    titulo: 'Gravação',
    ...p,
  };
}

function erros(v: EventoFormValues): Record<string, string> {
  const r = eventoFormSchema.safeParse(v);
  if (r.success) return {};
  return Object.fromEntries(r.error.issues.map((i) => [i.path.join('.'), i.message]));
}

afterEach(() => i18n.changeLanguage('pt'));

describe('eventoFormSchema in English', () => {
  it('resolves the zod messages at validation time', async () => {
    await i18n.changeLanguage('en');
    expect(erros(valores({ titulo: '  ' }))).toEqual({ titulo: 'Enter a title.' });
    expect(erros(valores({ link_reuniao: 'meet.google.com/x' }))).toEqual({
      link_reuniao: 'Enter a link that starts with http:// or https://.',
    });
    expect(erros(valores({ hora_fim: '13:00' }))).toEqual({
      hora_fim: 'The end must be after the start.',
    });
    expect(erros(valores({ titulo: 'x'.repeat(201) }))).toEqual({
      titulo: 'Use at most 200 characters.',
    });

    await i18n.changeLanguage('pt');
    expect(erros(valores({ titulo: '  ' }))).toEqual({ titulo: 'Informe um título.' });
    expect(erros(valores({ titulo: 'x'.repeat(201) }))).toEqual({
      titulo: 'Use no máximo 200 caracteres.',
    });
  });

  it('explains the series lock', async () => {
    await i18n.changeLanguage('en');
    expect(motivoSerie(['regra'])).toBe('Applies to the whole series: you changed the recurrence.');
    expect(motivoSerie(['regra', 'tipo'])).toBe('Applies to the whole series.');
  });

  it('validates the custom recurrence', async () => {
    await i18n.changeLanguage('en');
    const s = regraParaPersonalizada(null, SEG_5);
    expect(validarPersonalizada({ ...s, intervalo: '0' }, SEG_5)).toBe(
      'Use a number from 1 to 99.',
    );
    expect(validarPersonalizada({ ...s, termina: 'em', ate: undefined }, SEG_5)).toBe(
      'Choose the end date.',
    );
  });

  it('formats the series start', async () => {
    await i18n.changeLanguage('en');
    expect(rotuloDtstart('2026-10-06T14:00:00')).toBe('Tuesday, October 6');
  });
});

describe('opcoesMensaisPersonalizadas in English', () => {
  it('drops the Monthly prefix of the presets', async () => {
    await i18n.changeLanguage('en');
    expect(opcoesMensaisPersonalizadas(SEG_5).map((o) => o.label)).toEqual([
      'On day 5',
      expect.stringMatching(/^On the first Monday$/i),
    ]);
  });
});
