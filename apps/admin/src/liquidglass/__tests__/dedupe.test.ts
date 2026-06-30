import { describe, it, expect, beforeEach } from 'vitest';
import { stripBoundAndTagNew } from '../dedupe';

describe('stripBoundAndTagNew', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('tags all unbound panes on first pass and reports them as fresh', () => {
    document.body.innerHTML = `<div class="liquidGL" id="a"></div><div class="liquidGL" id="b"></div>`;
    expect(stripBoundAndTagNew(document)).toBe(2);
    expect(document.getElementById('a')!.dataset.lglBound).toBe('true');
    expect(document.getElementById('a')!.classList.contains('liquidGL')).toBe(true);
  });

  it('on a later pass strips already-bound panes and tags only new ones', () => {
    document.body.innerHTML = `<div class="liquidGL" id="chrome"></div>`;
    stripBoundAndTagNew(document); // bind chrome
    // a new route mounts a fresh tile:
    document.body.insertAdjacentHTML('beforeend', `<div class="liquidGL" id="tile"></div>`);
    const fresh = stripBoundAndTagNew(document);
    expect(fresh).toBe(1);
    // chrome had its class stripped so a re-scan won't re-bind it:
    expect(document.getElementById('chrome')!.classList.contains('liquidGL')).toBe(false);
    // the new tile keeps the class so the re-scan binds it:
    expect(document.getElementById('tile')!.classList.contains('liquidGL')).toBe(true);
    expect(document.getElementById('tile')!.dataset.lglBound).toBe('true');
  });
});
