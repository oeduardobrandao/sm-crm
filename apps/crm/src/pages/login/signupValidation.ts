export type SignupField = 'nome' | 'email' | 'password';

export type SignupFieldError =
  | 'nameRequired'
  | 'emailInvalid'
  | 'passwordShort'
  // Server-side: Supabase could not send the confirmation email to this address.
  | 'emailUndeliverable';

export type SignupErrorKey =
  | 'rateLimit'
  | 'weakPassword'
  | 'emailInvalid'
  | 'emailUndeliverable'
  | 'generic';

/** Order the fields appear in the form: focus goes to the first invalid one. */
export const SIGNUP_FIELDS: readonly SignupField[] = ['nome', 'email', 'password'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const SIGNUP_MIN_PASSWORD = 8;

/**
 * Client-side checks for the signup form. The form is `noValidate`: native `required`
 * blocked phones silently, so every rule lives here and renders under its field.
 */
export function validateSignup(v: {
  nome: string;
  email: string;
  password: string;
}): Partial<Record<SignupField, SignupFieldError>> {
  const errors: Partial<Record<SignupField, SignupFieldError>> = {};
  if (!v.nome.trim()) errors.nome = 'nameRequired';
  if (!EMAIL_RE.test(v.email.trim())) errors.email = 'emailInvalid';
  if (v.password.length < SIGNUP_MIN_PASSWORD) errors.password = 'passwordShort';
  return errors;
}

/**
 * Maps a Supabase `signUp` error to a copy key, so the raw (English, sometimes internal)
 * `error.message` never reaches the visitor.
 */
export function signupErrorKey(error: {
  code?: string;
  status?: number;
  message?: string;
}): SignupErrorKey {
  const code = error.code ?? '';
  if (error.status === 429 || code.includes('rate_limit')) return 'rateLimit';
  if (code === 'weak_password') return 'weakPassword';
  if (
    code === 'email_address_invalid' ||
    (code === 'validation_failed' && /email/i.test(error.message ?? ''))
  ) {
    return 'emailInvalid';
  }
  // GoTrue answers 500 `unexpected_failure` "Error sending confirmation email" when the mail
  // provider refuses the recipient (a domain with no MX, a "gmail.com.br" typo). supabase-js keeps
  // the 500 as an AuthApiError with that message; `code` can be absent on older API versions.
  // Matched narrowly so every other 500 stays generic. An SMTP outage lands here too, which is
  // why the copy asks to check the address instead of saying it is wrong.
  if (
    error.status === 500 &&
    (!code || code === 'unexpected_failure') &&
    /error sending confirmation e?mail/i.test(error.message ?? '')
  ) {
    return 'emailUndeliverable';
  }
  return 'generic';
}
