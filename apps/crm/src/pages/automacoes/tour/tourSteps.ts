/** Um passo do tour guiado. `anchor` é o valor do atributo data-tour do
 * elemento alvo; `surface` decide onde o overlay monta e o sistema de
 * coordenadas (página = fixed/viewport, dialog = absolute/local). */
export interface TourStep {
  id: string;
  surface: 'page' | 'dialog';
  anchor: string;
  titleKey: string;
  textKey: string;
  /** Só o passo 1: o CTA que abre o formulário. */
  ctaKey?: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'nova-automacao',
    surface: 'page',
    anchor: 'nova-automacao',
    titleKey: 'tour.step1Title',
    textKey: 'tour.step1Text',
    ctaKey: 'tour.step1Cta',
  },
  {
    id: 'campo-nome',
    surface: 'dialog',
    anchor: 'campo-nome',
    titleKey: 'tour.step2Title',
    textKey: 'tour.step2Text',
  },
  {
    id: 'campo-cliente',
    surface: 'dialog',
    anchor: 'campo-cliente',
    titleKey: 'tour.step3Title',
    textKey: 'tour.step3Text',
  },
  {
    id: 'campo-alvo',
    surface: 'dialog',
    anchor: 'campo-alvo',
    titleKey: 'tour.step4Title',
    textKey: 'tour.step4Text',
  },
  {
    id: 'campo-palavras',
    surface: 'dialog',
    anchor: 'campo-palavras',
    titleKey: 'tour.step5Title',
    textKey: 'tour.step5Text',
  },
  {
    id: 'campo-dm',
    surface: 'dialog',
    anchor: 'campo-dm',
    titleKey: 'tour.step6Title',
    textKey: 'tour.step6Text',
  },
  {
    id: 'campo-botoes',
    surface: 'dialog',
    anchor: 'campo-botoes',
    titleKey: 'tour.step7Title',
    textKey: 'tour.step7Text',
  },
  {
    id: 'campo-resposta',
    surface: 'dialog',
    anchor: 'campo-resposta',
    titleKey: 'tour.step8Title',
    textKey: 'tour.step8Text',
  },
];
