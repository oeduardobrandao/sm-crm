/**
 * Catches common typos in the domain of a signup email ("gmail.com.br", "hotmal.com", "ana@gmail")
 * so the form can offer a one-tap fix before Supabase tries to mail a domain that does not exist.
 * The hint is advisory: submission is never blocked on it.
 */

/** Real domains, some of them one edit away from a popular one. An exact hit is never flagged. */
const KNOWN_VALID = new Set([
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'hotmail.com.br',
  'hotmail.com.ar',
  'outlook.com',
  'outlook.com.br',
  'outlook.com.ar',
  'outlook.com.tr',
  'hotmail.com.tr',
  'yahoo.com.tr',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'yahoo.com.ar',
  'yahoo.com.mx',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'mail.com',
  'email.com',
  'gmx.com',
  'cloud.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'ig.com.br',
  'globo.com',
  'globomail.com',
  'protonmail.com',
  'proton.me',
]);

/** Typos the edit-distance check below would miss or get wrong. */
const KNOWN_TYPOS: Record<string, string> = {
  'gmail.com.br': 'gmail.com',
  'gmail.br': 'gmail.com',
  'gmail.con.br': 'gmail.com',
  'icloud.com.br': 'icloud.com',
  'yahoo.com.b': 'yahoo.com.br',
  'yahoo.br': 'yahoo.com.br',
  'hotmail.br': 'hotmail.com.br',
  'hotmail.com.b': 'hotmail.com.br',
  'outlook.br': 'outlook.com.br',
};

/**
 * Popular domains a typo is matched against. Short ones (live.com, me.com) are left out: at one
 * edit they would collide with too many real company domains.
 */
const FUZZY_TARGETS = [
  'gmail.com',
  'hotmail.com',
  'outlook.com',
  'yahoo.com',
  'icloud.com',
  'yahoo.com.br',
  'hotmail.com.br',
  'outlook.com.br',
];

/** A domain typed with no TLD at all ("ana@gmail") resolves to the provider's main domain. */
const PROVIDER_BY_LABEL: Record<string, string> = {
  gmail: 'gmail.com',
  hotmail: 'hotmail.com',
  outlook: 'outlook.com',
  yahoo: 'yahoo.com',
  icloud: 'icloud.com',
};

/**
 * Optimal string alignment distance: Levenshtein plus adjacent transpositions, so "gmial" is one
 * edit from "gmail", not two.
 */
export function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) d[i][0] = i;
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

function fixDomain(domain: string): string | null {
  if (KNOWN_VALID.has(domain)) return null;
  // Own keys only: the domain is user input, and "constructor" or "__proto__" would hit the prototype.
  if (hasOwn(KNOWN_TYPOS, domain)) return KNOWN_TYPOS[domain];
  if (!domain.includes('.')) {
    if (hasOwn(PROVIDER_BY_LABEL, domain)) return PROVIDER_BY_LABEL[domain];
    const label = Object.keys(PROVIDER_BY_LABEL).find((p) => editDistance(domain, p) === 1);
    if (label) return PROVIDER_BY_LABEL[label];
    // Falls through for a dropped dot ("gmailcom").
  }
  return FUZZY_TARGETS.find((target) => editDistance(domain, target) === 1) ?? null;
}

/**
 * Returns the corrected address when the domain looks like a typo of a popular provider, or null.
 * The local part is kept exactly as typed; only the domain is lowercased and fixed.
 */
export function suggestEmailFix(email: string): string | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || trimmed.indexOf('@') !== at) return null;
  const local = trimmed.slice(0, at);
  const typed = trimmed.slice(at + 1).toLowerCase();
  // A trailing dot ("gmail.com.") is a typo of its own; strip it before matching.
  const domain = typed.replace(/\.+$/, '');
  if (!domain || /\s/.test(domain)) return null;
  const fixed = fixDomain(domain) ?? (domain !== typed && KNOWN_VALID.has(domain) ? domain : null);
  return fixed ? `${local}@${fixed}` : null;
}
