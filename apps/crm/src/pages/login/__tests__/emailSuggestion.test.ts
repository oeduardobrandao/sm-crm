import { describe, expect, it } from 'vitest';
import { editDistance, suggestEmailFix } from '../emailSuggestion';

describe('editDistance', () => {
  it('counts an adjacent transposition as one edit', () => {
    expect(editDistance('gmial', 'gmail')).toBe(1);
    expect(editDistance('gmail.com', 'gmail.com')).toBe(0);
    expect(editDistance('hotmal.com', 'hotmail.com')).toBe(1);
    expect(editDistance('abc', '')).toBe(3);
  });
});

describe('suggestEmailFix', () => {
  it.each([
    ['ana@gmail.com.br', 'ana@gmail.com'],
    ['ana@gmial.com', 'ana@gmail.com'],
    ['ana@gmai.com', 'ana@gmail.com'],
    ['ana@gamil.com', 'ana@gmail.com'],
    ['ana@gmail.co', 'ana@gmail.com'],
    ['ana@gmail.con', 'ana@gmail.com'],
    ['ana@gmailcom', 'ana@gmail.com'],
    ['ana@gmail', 'ana@gmail.com'],
    ['ana@gmial', 'ana@gmail.com'],
    ['ana@gmail.com.', 'ana@gmail.com'],
    ['ana@hotmal.com', 'ana@hotmail.com'],
    ['ana@hotmail.com.b', 'ana@hotmail.com.br'],
    ['ana@outlok.com', 'ana@outlook.com'],
    ['ana@yahoo.com.b', 'ana@yahoo.com.br'],
    ['ana@yaho.com.br', 'ana@yahoo.com.br'],
    ['ana@icloud.com.br', 'ana@icloud.com'],
  ])('fixes %s to %s', (input, expected) => {
    expect(suggestEmailFix(input)).toBe(expected);
  });

  it('keeps the local part as typed and lowercases only the domain', () => {
    expect(suggestEmailFix('  Ana.Souza+crm@GMAIL.COM.BR ')).toBe('Ana.Souza+crm@gmail.com');
  });

  it.each([
    'ana@gmail.com',
    'ana@hotmail.com.br',
    'ana@outlook.com.br',
    'ana@yahoo.com.br',
    'ana@yahoo.com.ar',
    'ana@hotmail.com.ar',
    'ana@mail.com',
    'ana@email.com',
    'ana@ymail.com',
    'ana@gmx.com',
    'ana@live.com',
    'ana@me.com',
    'ana@uol.com.br',
    'ana@bol.com.br',
    'ana@terra.com.br',
    'ana@cloud.com',
    'ana@agencia.com',
    'ana@agencia.com.br',
    'ana@hotmail.fr',
    'ana@hotmail.com.tr',
    'ana@yahoo.com.tr',
  ])('leaves %s alone', (input) => {
    expect(suggestEmailFix(input)).toBeNull();
  });

  it('ignores input that is not an address yet', () => {
    expect(suggestEmailFix('')).toBeNull();
    expect(suggestEmailFix('ana')).toBeNull();
    expect(suggestEmailFix('@gmail.co')).toBeNull();
    expect(suggestEmailFix('ana@')).toBeNull();
    expect(suggestEmailFix('a@b@gmail.co')).toBeNull();
    expect(suggestEmailFix('ana@constructor')).toBeNull();
    expect(suggestEmailFix('ana@__proto__')).toBeNull();
    expect(suggestEmailFix('ana@toString')).toBeNull();
  });
});
