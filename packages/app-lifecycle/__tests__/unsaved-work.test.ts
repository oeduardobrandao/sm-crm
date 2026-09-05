import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasUnsavedWork,
  holdUnsavedWork,
  isDocumentBusy,
  resetUnsavedWorkForTests,
  trackUnsavedWork,
} from '../src/unsaved-work';

beforeEach(() => {
  resetUnsavedWorkForTests();
  document.body.innerHTML = '';
});

describe('holdUnsavedWork', () => {
  it('is clean with no holds', () => {
    expect(hasUnsavedWork()).toBe(false);
  });

  it('holds until released', () => {
    const release = holdUnsavedWork();
    expect(hasUnsavedWork()).toBe(true);
    release();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('stays held while any hold remains', () => {
    const a = holdUnsavedWork();
    const b = holdUnsavedWork();
    a();
    expect(hasUnsavedWork()).toBe(true);
    b();
    expect(hasUnsavedWork()).toBe(false);
  });

  it('ignores a second release of the same hold', () => {
    const a = holdUnsavedWork();
    const b = holdUnsavedWork();
    a();
    a();
    expect(hasUnsavedWork()).toBe(true);
    b();
    expect(hasUnsavedWork()).toBe(false);
  });
});

describe('trackUnsavedWork', () => {
  it('holds until the promise resolves and passes the value through', async () => {
    let resolve!: (value: string) => void;
    const work = new Promise<string>((r) => (resolve = r));
    const tracked = trackUnsavedWork(work);
    expect(hasUnsavedWork()).toBe(true);
    resolve('ok');
    await expect(tracked).resolves.toBe('ok');
    expect(hasUnsavedWork()).toBe(false);
  });

  it('releases when the promise rejects', async () => {
    const tracked = trackUnsavedWork(Promise.reject(new Error('upload failed')));
    expect(hasUnsavedWork()).toBe(true);
    await expect(tracked).rejects.toThrow('upload failed');
    expect(hasUnsavedWork()).toBe(false);
  });
});

describe('isDocumentBusy', () => {
  it('is false for a plain page', () => {
    document.body.innerHTML = '<main><h1>Entregas</h1><input type="checkbox" /></main>';
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true with an open dialog', () => {
    document.body.innerHTML = '<div role="dialog">Novo cliente</div>';
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true with an open alert dialog', () => {
    document.body.innerHTML = '<div role="alertdialog">Fechar sem salvar?</div>';
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true while a text input is focused', () => {
    document.body.innerHTML = '<input type="search" />';
    document.querySelector('input')!.focus();
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores a focused checkbox', () => {
    document.body.innerHTML = '<input type="checkbox" />';
    document.querySelector('input')!.focus();
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true while a contenteditable is focused', () => {
    document.body.innerHTML = '<div contenteditable="true" tabindex="0"></div>';
    document.querySelector<HTMLElement>('[contenteditable]')!.focus();
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true with a textarea that has content', () => {
    document.body.innerHTML = '<textarea></textarea>';
    document.querySelector('textarea')!.value = 'rascunho';
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores an empty textarea', () => {
    document.body.innerHTML = '<textarea>   </textarea>';
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true with a contenteditable that has content', () => {
    document.body.innerHTML = '<div contenteditable="true"><p>Legenda do post</p></div>';
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores an empty contenteditable', () => {
    document.body.innerHTML = '<div contenteditable="true"><p></p></div>';
    expect(isDocumentBusy()).toBe(false);
  });
});
