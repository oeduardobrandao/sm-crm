import { CAMADAS, type CamadasAtivas } from './tipos';

export const CAMADAS_STORAGE_KEY = 'agenda-camadas';

/** Commemorative dates start off: ~37 a month crowd the grid. */
export const CAMADAS_PADRAO: CamadasAtivas = {
  posts: true,
  prazos: true,
  recebimentos: true,
  pagamentos: true,
  datas: true,
  comemorativas: false,
};

/** Per-browser toggles. Unknown keys are dropped, missing or non-boolean ones
 *  fall back to the default; storage that throws or holds garbage = default. */
export function lerCamadas(): CamadasAtivas {
  try {
    const raw = localStorage.getItem(CAMADAS_STORAGE_KEY);
    if (!raw) return { ...CAMADAS_PADRAO };
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...CAMADAS_PADRAO };
    const salvo = v as Record<string, unknown>;
    const ativas = { ...CAMADAS_PADRAO };
    for (const id of CAMADAS) {
      if (typeof salvo[id] === 'boolean') ativas[id] = salvo[id] as boolean;
    }
    return ativas;
  } catch {
    return { ...CAMADAS_PADRAO };
  }
}

export function gravarCamadas(ativas: CamadasAtivas): void {
  try {
    localStorage.setItem(CAMADAS_STORAGE_KEY, JSON.stringify(ativas));
  } catch {
    // Private mode / blocked storage: the toggles just are not remembered.
  }
}
