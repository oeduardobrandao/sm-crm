import { describe, expect, it, vi } from 'vitest';
import { openCSVSelector, parseCSV } from '../csv';

describe('parseCSV', () => {
  it('returns an empty array when the file has only a header row', () => {
    expect(parseCSV('nome,email')).toEqual([]);
  });

  it('returns an empty array when the input is blank', () => {
    expect(parseCSV('')).toEqual([]);
  });

  it('lowercases headers and trims whitespace around values', () => {
    const rows = parseCSV('Nome, Email \n Ana , ana@x.com ');
    expect(rows).toEqual([{ nome: 'Ana', email: 'ana@x.com' }]);
  });

  it('skips blank lines between records', () => {
    const rows = parseCSV('nome\nAna\n\nBruno\n');
    expect(rows).toEqual([{ nome: 'Ana' }, { nome: 'Bruno' }]);
  });

  it('preserves commas inside quoted fields and strips the surrounding quotes', () => {
    const rows = parseCSV('nome,valor\n"Silva, Ana","1,99"');
    expect(rows).toEqual([{ nome: 'Silva, Ana', valor: '1,99' }]);
  });

  it('fills missing columns with empty strings', () => {
    const rows = parseCSV('a,b,c\nx,y');
    expect(rows).toEqual([{ a: 'x', b: 'y', c: '' }]);
  });

  it('keeps newlines inside quoted fields as a single record', () => {
    const csv =
      'pergunta,secao,resposta\n' +
      'Objetivos,FASE 1,"1. Autoridade\n2. Consolidar autoridade\n3. Fortalecer consultório"';
    expect(parseCSV(csv)).toEqual([
      {
        pergunta: 'Objetivos',
        secao: 'FASE 1',
        resposta: '1. Autoridade\n2. Consolidar autoridade\n3. Fortalecer consultório',
      },
    ]);
  });

  it('preserves blank lines inside a quoted multi-paragraph field', () => {
    const csv = 'pergunta,resposta\nHistória,"Primeiro parágrafo.\n\nSegundo parágrafo."';
    expect(parseCSV(csv)).toEqual([
      { pergunta: 'História', resposta: 'Primeiro parágrafo.\n\nSegundo parágrafo.' },
    ]);
  });

  it('unescapes doubled quotes inside quoted fields', () => {
    const rows = parseCSV('nome,nota\nAna,"Ela disse ""oi"" hoje"');
    expect(rows).toEqual([{ nome: 'Ana', nota: 'Ela disse "oi" hoje' }]);
  });

  it('handles CRLF line endings, including inside quoted fields', () => {
    const csv = 'pergunta,resposta\r\nP1,"linha 1\r\nlinha 2"\r\n';
    expect(parseCSV(csv)).toEqual([{ pergunta: 'P1', resposta: 'linha 1\r\nlinha 2' }]);
  });

  it('strips a leading UTF-8 BOM from the first header', () => {
    const rows = parseCSV('﻿pergunta,resposta\nP1,R1');
    expect(rows).toEqual([{ pergunta: 'P1', resposta: 'R1' }]);
  });
});

describe('openCSVSelector', () => {
  function stubFile(text: string) {
    return {
      text: () => Promise.resolve(text),
    } as unknown as File;
  }

  it('parses a valid CSV file and invokes onUpload with the rows', async () => {
    const onUpload = vi.fn();
    const onError = vi.fn();

    openCSVSelector(onUpload, onError);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    const file = stubFile('nome\nAna');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith([{ nome: 'Ana' }]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('calls onError when the parsed CSV has no data rows', async () => {
    const onUpload = vi.fn();
    const onError = vi.fn();

    openCSVSelector(onUpload, onError);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = stubFile('nome\n');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('does nothing when the user cancels the file picker', async () => {
    const onUpload = vi.fn();
    const onError = vi.fn();

    openCSVSelector(onUpload, onError);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    input.dispatchEvent(new Event('change'));

    await Promise.resolve();
    expect(onUpload).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
