import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAMADAS_PADRAO, CAMADAS_STORAGE_KEY, gravarCamadas, lerCamadas } from '../camadasStorage';

describe('camadasStorage', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('defaults to every layer on except commemorative dates', () => {
    expect(CAMADAS_PADRAO).toEqual({
      posts: true,
      prazos: true,
      recebimentos: true,
      pagamentos: true,
      datas: true,
      comemorativas: false,
    });
    expect(lerCamadas()).toEqual(CAMADAS_PADRAO);
  });

  it('round-trips what was saved', () => {
    gravarCamadas({ ...CAMADAS_PADRAO, posts: false, comemorativas: true });
    expect(lerCamadas()).toEqual({ ...CAMADAS_PADRAO, posts: false, comemorativas: true });
  });

  it.each(['{nope', '[]', 'null', '42', '"x"'])(
    'corrupt storage %s reads as the default',
    (raw) => {
      localStorage.setItem(CAMADAS_STORAGE_KEY, raw);
      expect(lerCamadas()).toEqual(CAMADAS_PADRAO);
    },
  );

  it('keeps valid keys and ignores unknown or non-boolean ones', () => {
    localStorage.setItem(
      CAMADAS_STORAGE_KEY,
      JSON.stringify({ posts: false, prazos: 'sim', foo: true }),
    );
    expect(lerCamadas()).toEqual({ ...CAMADAS_PADRAO, posts: false });
  });

  it('a throwing localStorage reads as the default and writes are swallowed', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(lerCamadas()).toEqual(CAMADAS_PADRAO);
    expect(() => gravarCamadas(CAMADAS_PADRAO)).not.toThrow();
  });

  it('returns a fresh object, never the shared default', () => {
    const a = lerCamadas();
    a.posts = false;
    expect(CAMADAS_PADRAO.posts).toBe(true);
  });
});
