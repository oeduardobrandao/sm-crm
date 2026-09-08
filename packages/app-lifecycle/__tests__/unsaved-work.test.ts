import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  hasUnsavedWork,
  holdUnsavedWork,
  isDocumentBusy,
  resetUnsavedWorkForTests,
  trackDocumentEdits,
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

  it('does not go negative when a stale release fires after a reset', () => {
    const stale = holdUnsavedWork();
    resetUnsavedWorkForTests();
    stale();
    const live = holdUnsavedWork();
    expect(hasUnsavedWork()).toBe(true);
    live();
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

  it('gives up the hold at the ceiling when the promise never settles', () => {
    vi.useFakeTimers();
    try {
      trackUnsavedWork(new Promise<never>(() => {}), 1_000);
      expect(hasUnsavedWork()).toBe(true);
      vi.advanceTimersByTime(1_000);
      expect(hasUnsavedWork()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('defaults the ceiling to 30 minutes', () => {
    vi.useFakeTimers();
    try {
      trackUnsavedWork(new Promise<never>(() => {}));
      vi.advanceTimersByTime(30 * 60_000 - 1);
      expect(hasUnsavedWork()).toBe(true);
      vi.advanceTimersByTime(1);
      expect(hasUnsavedWork()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
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
});

describe('isDocumentBusy: edits', () => {
  let stop: () => void;
  beforeEach(() => {
    stop = trackDocumentEdits();
  });
  afterEach(() => stop());

  it('ignores pre-filled content nobody touched', () => {
    document.body.innerHTML =
      '<textarea>legenda</textarea><div contenteditable="true"><p>Corpo</p></div>';
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true after the user types into a textarea, until it leaves the DOM', () => {
    document.body.innerHTML = '<textarea></textarea>';
    const el = document.querySelector('textarea')!;
    el.value = 'r';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(isDocumentBusy()).toBe(true);
    el.remove();
    expect(isDocumentBusy()).toBe(false);
  });

  it('is true after the user types into a contenteditable', () => {
    document.body.innerHTML = '<div contenteditable="true"><p></p></div>';
    const host = document.querySelector<HTMLElement>('[contenteditable]')!;
    host.dispatchEvent(new Event('input', { bubbles: true }));
    expect(isDocumentBusy()).toBe(true);
  });

  it('counts an input event on a checkbox too (real browsers fire input then change)', () => {
    document.body.innerHTML = '<input type="checkbox" />';
    document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(isDocumentBusy()).toBe(true);
  });

  it('records nothing once stopped', () => {
    stop();
    document.body.innerHTML = '<textarea></textarea>';
    document.querySelector('textarea')!.dispatchEvent(new Event('input', { bubbles: true }));
    expect(isDocumentBusy()).toBe(false);
    stop = trackDocumentEdits();
  });

  it('is true after the user changes a select or a checkbox, until it leaves the DOM', () => {
    document.body.innerHTML =
      '<select><option>a</option><option>b</option></select><input type="checkbox" />';
    const select = document.querySelector('select')!;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(isDocumentBusy()).toBe(true);
    select.remove();
    expect(isDocumentBusy()).toBe(false);

    const checkbox = document.querySelector('input')!;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(isDocumentBusy()).toBe(true);
  });

  it('is true after the user picks a colour or a radio', () => {
    document.body.innerHTML = '<input type="color" /><input type="radio" name="r" />';
    document.querySelector('[type="color"]')!.dispatchEvent(new Event('change', { bubbles: true }));
    expect(isDocumentBusy()).toBe(true);
  });

  it('ignores change events from a file input and from buttons', () => {
    document.body.innerHTML = '<input type="file" /><input type="submit" /><button>Ok</button>';
    for (const el of document.querySelectorAll('input, button')) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    expect(isDocumentBusy()).toBe(false);
  });
});
