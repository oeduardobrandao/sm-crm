/** Workspace language for e-mail, push and report output. Default and every failure path is pt. */
export type Lang = "pt" | "en";

export function resolveLang(value: unknown): Lang {
  return value === "en" ? "en" : "pt";
}

export function intlLocale(lang: Lang): "pt-BR" | "en-US" {
  return lang === "en" ? "en-US" : "pt-BR";
}

export function formatDate(
  iso: string,
  lang: Lang,
  opts: Intl.DateTimeFormatOptions & { timeZone?: string } = {},
): string {
  const timeZone = opts.timeZone ?? (lang === "en" ? "America/New_York" : "America/Sao_Paulo");
  return new Intl.DateTimeFormat(intlLocale(lang), { ...opts, timeZone }).format(new Date(iso));
}

export function formatMoney(cents: number, currency: "brl" | "usd", lang: Lang): string {
  return new Intl.NumberFormat(intlLocale(lang), {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}
