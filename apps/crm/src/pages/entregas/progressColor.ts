/**
 * Cor da barra de progresso dos cards (post e fluxo): amarela no primeiro
 * trecho preenchido e esverdeando a cada etapa até o verde cheio na última.
 * A cor diz em que ponto do processo o card está; o prazo já tem o DeadlinePill.
 *
 * A largura da barra é etapaIdx / total, então na primeira etapa (idx 0) ela
 * está vazia e o primeiro preenchimento visível é o da idx 1: é ali que a
 * rampa começa amarela, senão o amarelo nunca apareceria.
 *
 * Interpola em HSL entre o amarelo (#eab308) e o verde (#3ecf8e) da paleta,
 * passando pelos verdes-limão no meio em vez de um marrom acinzentado.
 */
const START = { h: 45, s: 93, l: 47 };
const END = { h: 153, s: 60, l: 53 };

export function progressColor(etapaIdx: number, totalEtapas: number): string {
  const last = totalEtapas - 1;
  const t =
    last <= 1 ? (etapaIdx >= last ? 1 : 0) : Math.min(1, Math.max(0, (etapaIdx - 1) / (last - 1)));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `hsl(${mix(START.h, END.h)} ${mix(START.s, END.s)}% ${mix(START.l, END.l)}%)`;
}
