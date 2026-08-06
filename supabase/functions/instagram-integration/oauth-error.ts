// Map a Meta OAuth failure to a stable code the CRM turns into user guidance.
// Order matters: the most specific, unambiguous signals come first. Regexes
// cover Meta's pt-BR and en messages; keep them narrow to avoid misclassifying
// (e.g. scope names like instagram_business_basic must not match the
// "not a business account" case).
export function classifyOAuthError(msg: string, params: URLSearchParams): string {
  if (params.get('error') === 'access_denied' || /user[_ ]denied|access[_ ]denied/i.test(msg)) {
    return 'cancelled';
  }
  if (/^MISSING_PERMISSIONS/.test(msg)) return 'missing_permissions';
  if (/off[-_ ]?meta|fora das tecnologias|atividade futura|future off/i.test(msg)) {
    return 'off_meta_activity';
  }
  // Covers both nonce failures ("OAuth state expired or already used") and the
  // signed-state 10-minute lifetime ("State expired") from oauth-state.ts.
  if (/state expired|already used/i.test(msg)) return 'state_expired';
  if (/not a (business|professional|creator)|(business|professional|creator) account (is )?required|conta (comercial|profissional|business)/i.test(msg)) {
    return 'no_business_account';
  }
  if (/checkpoint|account (is )?(restricted|suspended|disabled)|conta (restrita|suspensa|desativada)/i.test(msg)) {
    return 'account_restricted';
  }
  if (/request limit|rate limit|too many (calls|requests)|\(#4\)|\(#17\)|\(#613\)/i.test(msg)) {
    return 'rate_limited';
  }
  return '1';
}

// App misconfiguration is on us, not the user: the caller alerts internally
// and keeps the generic code outward.
export function isAppConfigError(msg: string): boolean {
  return /development mode|app not active|not currently accessible|app is disabled/i.test(msg);
}
