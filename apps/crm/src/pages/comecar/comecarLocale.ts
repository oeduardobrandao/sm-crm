import { useIntlLocale } from '@mesaas/i18n';
import { formatTrialDate, REVERSE_TRIAL_TIME_ZONE } from '@/lib/reverseTrial';
import type { ComecarLang } from './recommend';

/** /comecar copy language, following the UI language (not the workspace currency). */
export function useComecarLang(): ComecarLang {
  return useIntlLocale() === 'en-US' ? 'en' : 'pt';
}

const enTrialDate = new Intl.DateTimeFormat('en-US', {
  timeZone: REVERSE_TRIAL_TIME_ZONE,
  month: 'long',
  day: 'numeric',
});

/** Reverse-trial end date: "8 de dezembro" (São Paulo) or "December 8". */
export function formatComecarTrialDate(value: string | Date, lang: ComecarLang): string {
  if (lang === 'pt') return formatTrialDate(value);
  return enTrialDate.format(typeof value === 'string' ? new Date(value) : value);
}
