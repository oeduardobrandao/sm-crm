// Client-side pre-validation for the Pagar.me card form. Format + check-digit level only:
// the gateway is the real authority. Nothing here is ever persisted or logged.

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '');
}

/** Luhn checksum over 13-19 digits. */
export function luhnValid(cardNumber: string): boolean {
  const digits = onlyDigits(cardNumber);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** "MM/AA" -> { month, year(4 digits) } when well-formed and not in the past; null otherwise. */
export function parseExpiry(
  value: string,
  now: Date = new Date(),
): { month: number; year: number } | null {
  const m = /^(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const year = 2000 + Number(m[2]);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59);
  if (endOfMonth < now) return null;
  return { month, year };
}

function cpfValid(d: string): boolean {
  if (/^(\d)\1{10}$/.test(d)) return false;
  for (const len of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const dv = ((sum * 10) % 11) % 10;
    if (dv !== Number(d[len])) return false;
  }
  return true;
}

function cnpjValid(d: string): boolean {
  if (/^(\d)\1{13}$/.test(d)) return false;
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const len of [12, 13]) {
    const w = weights.slice(13 - len);
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * w[i];
    const dv = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (dv !== Number(d[len])) return false;
  }
  return true;
}

/** CPF (11 digits) or CNPJ (14 digits), check digits verified. */
export function documentValid(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length === 11) return cpfValid(d);
  if (d.length === 14) return cnpjValid(d);
  return false;
}

export function maskCardNumber(v: string): string {
  return onlyDigits(v)
    .slice(0, 19)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

export function maskExpiry(v: string): string {
  const d = onlyDigits(v).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export function maskDocument(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

export function maskCep(v: string): string {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function maskPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** { ddd, number } from a masked/raw phone with 10-11 digits, else null. */
export function splitPhone(value: string): { ddd: string; number: string } | null {
  const d = onlyDigits(value);
  if (d.length < 10 || d.length > 11) return null;
  return { ddd: d.slice(0, 2), number: d.slice(2) };
}
