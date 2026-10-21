/** Minúsculas e sem diacríticos, para "automacao" encontrar "Automação". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}
