import { describe, expect, it } from 'vitest';
import { signupErrorKey, validateSignup } from '../signupValidation';

describe('validateSignup', () => {
  it('flags a blank name, a malformed email and a short password', () => {
    expect(validateSignup({ nome: '  ', email: 'ana@agencia', password: 'abc123' })).toEqual({
      nome: 'nameRequired',
      email: 'emailInvalid',
      password: 'passwordShort',
    });
  });

  it('accepts valid values, trimming the name and the email', () => {
    expect(
      validateSignup({ nome: 'Ana', email: ' ana@agencia.com ', password: '12345678' }),
    ).toEqual({});
  });

  it('rejects an email with spaces inside it', () => {
    expect(
      validateSignup({ nome: 'Ana', email: 'ana @agencia.com', password: '12345678' }),
    ).toEqual({ email: 'emailInvalid' });
  });
});

describe('signupErrorKey', () => {
  it('maps a 429 to the rate-limit copy', () => {
    expect(signupErrorKey({ status: 429 })).toBe('rateLimit');
  });

  it('maps a rate-limit code without a status', () => {
    expect(signupErrorKey({ code: 'over_email_send_rate_limit' })).toBe('rateLimit');
  });

  it('maps a weak password', () => {
    expect(signupErrorKey({ code: 'weak_password' })).toBe('weakPassword');
  });

  it('maps an invalid email', () => {
    expect(signupErrorKey({ code: 'email_address_invalid' })).toBe('emailInvalid');
    expect(signupErrorKey({ code: 'validation_failed', message: 'Unable to validate email' })).toBe(
      'emailInvalid',
    );
  });

  it('maps a failed confirmation email to the undeliverable copy', () => {
    expect(
      signupErrorKey({
        status: 500,
        code: 'unexpected_failure',
        message: 'Error sending confirmation email',
      }),
    ).toBe('emailUndeliverable');
    // Older API versions send no code.
    expect(signupErrorKey({ status: 500, message: 'Error sending confirmation mail' })).toBe(
      'emailUndeliverable',
    );
  });

  it('keeps unrelated 500s and look-alike messages generic', () => {
    expect(signupErrorKey({ status: 500, message: 'Database error saving new user' })).toBe(
      'generic',
    );
    expect(
      signupErrorKey({
        status: 500,
        code: 'unexpected_failure',
        message: 'Error sending magic link',
      }),
    ).toBe('generic');
    expect(signupErrorKey({ status: 400, message: 'Error sending confirmation email' })).toBe(
      'generic',
    );
    expect(
      signupErrorKey({
        status: 500,
        code: 'hook_timeout',
        message: 'Error sending confirmation email',
      }),
    ).toBe('generic');
  });

  it('falls back to the generic copy', () => {
    expect(signupErrorKey({ message: 'boom' })).toBe('generic');
    expect(signupErrorKey({ code: 'validation_failed', message: 'bad payload' })).toBe('generic');
  });
});
