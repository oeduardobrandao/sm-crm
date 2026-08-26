/**
 * Auto-start do tour driver.js. wizardOpen: o deep link do guia
 * (?novo-fluxo=1) chega exatamente no estado que dispararia o tour; dois
 * overlays de onboarding ao mesmo tempo é proibido (spec do guia).
 */
export function shouldAutoStartTour(i: {
  isLoading: boolean;
  alreadyStarted: boolean;
  tourDone: boolean;
  showExample: boolean;
  wizardOpen: boolean;
}): boolean {
  return !i.isLoading && !i.alreadyStarted && !i.tourDone && i.showExample && !i.wizardOpen;
}
