import { describe, expect, it } from 'vitest';
import { dmMessageLimit, validateDmButtons } from '../dmButtons';

const ok = { title: 'Agendar', url: 'https://agenda.x' };

describe('validateDmButtons', () => {
  it('aceita 0 botões com qualquer texto até 1000', () => {
    expect(validateDmButtons([], 'a'.repeat(1000))).toBeNull();
  });

  it('aceita até 3 botões válidos', () => {
    expect(validateDmButtons([ok, ok, ok], 'msg')).toBeNull();
  });

  it('rejeita mais de 3 botões', () => {
    expect(validateDmButtons([ok, ok, ok, ok], 'msg')).toBe('form.validationButtonsMax');
  });

  it('rejeita título vazio ou só espaços', () => {
    expect(validateDmButtons([{ title: '  ', url: 'https://a.b' }], 'msg')).toBe(
      'form.validationButtonTitle',
    );
  });

  it('rejeita título com mais de 20 chars', () => {
    expect(validateDmButtons([{ title: 't'.repeat(21), url: 'https://a.b' }], 'msg')).toBe(
      'form.validationButtonTitle',
    );
  });

  it('rejeita URL sem esquema http(s): o sanitizer reescreveria, o banco não', () => {
    expect(validateDmButtons([{ title: 'Ok', url: 'example.com' }], 'msg')).toBe(
      'form.validationButtonUrl',
    );
  });

  it('rejeita esquemas perigosos e URLs com credenciais', () => {
    for (const url of [
      'ftp://a.b',
      'javascript:alert(1)',
      'https://user:pass@a.b',
      'https://good.com\\@evil.com/phish',
    ]) {
      expect(validateDmButtons([{ title: 'Ok', url }], 'msg')).toBe('form.validationButtonUrl');
    }
  });

  it('rejeita URL com mais de 500 chars', () => {
    expect(validateDmButtons([{ title: 'Ok', url: `https://a.b/${'x'.repeat(500)}` }], 'msg')).toBe(
      'form.validationButtonUrl',
    );
  });

  it('rejeita texto acima de 640 quando há botão (edição de automação antiga)', () => {
    expect(validateDmButtons([ok], 'a'.repeat(641))).toBe('form.validationDmWithButtons');
    expect(validateDmButtons([ok], 'a'.repeat(640))).toBeNull();
  });
});

describe('dmMessageLimit', () => {
  it('640 com botão, 1000 sem', () => {
    expect(dmMessageLimit([])).toBe(1000);
    expect(dmMessageLimit([ok])).toBe(640);
  });
});
