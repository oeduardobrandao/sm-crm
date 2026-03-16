// =============================================
// Reusable Password Toggle & Strength Helpers
// =============================================
// Note: All innerHTML in this file uses hardcoded static SVG markup only.
// No user-provided data is interpolated — safe from XSS.

const eyeSvgOpen = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>
</svg>`;

const eyeSvgClosed = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/**
 * Returns HTML for an eye toggle button inside a password input wrapper.
 * The wrapper must have `position: relative`.
 */
export function passwordToggleHTML(btnId: string): string {
  return `<button class="password-eye-toggle" type="button" aria-label="Mostrar senha" id="${btnId}">${eyeSvgOpen}</button>`;
}

/**
 * Returns HTML for the 3 password strength hint pills.
 */
export function passwordStrengthHTML(prefix: string): string {
  return `
    <div class="password-strength-hints">
      <span class="password-hint-pill" id="${prefix}-hint-len">
        <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
        8+ caracteres
      </span>
      <span class="password-hint-pill" id="${prefix}-hint-upper">
        <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
        Maiúscula
      </span>
      <span class="password-hint-pill" id="${prefix}-hint-num">
        <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
        Número
      </span>
    </div>`;
}

/**
 * Wires up the eye toggle button to show/hide the password input.
 * Uses innerHTML only with hardcoded static SVG — no user data.
 */
export function attachPasswordToggle(container: HTMLElement, inputId: string, btnId: string): void {
  const input = container.querySelector(`#${inputId}`) as HTMLInputElement | null;
  const btn = container.querySelector(`#${btnId}`) as HTMLButtonElement | null;
  if (!input || !btn) return;

  btn.addEventListener('click', () => {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    // Safe: only hardcoded SVG strings, no user data
    btn.innerHTML = isPassword ? eyeSvgClosed : eyeSvgOpen;
    btn.setAttribute('aria-label', isPassword ? 'Ocultar senha' : 'Mostrar senha');
  });
}

/**
 * Wires up real-time password strength hint updates.
 */
export function attachPasswordStrength(container: HTMLElement, inputId: string, prefix: string): void {
  const input = container.querySelector(`#${inputId}`) as HTMLInputElement | null;
  if (!input) return;

  input.addEventListener('input', () => {
    const val = input.value;
    container.querySelector(`#${prefix}-hint-len`)?.classList.toggle('met', val.length >= 8);
    container.querySelector(`#${prefix}-hint-upper`)?.classList.toggle('met', /[A-Z]/.test(val));
    container.querySelector(`#${prefix}-hint-num`)?.classList.toggle('met', /[0-9]/.test(val));
  });
}

/**
 * Validates password meets requirements. Returns error message or null if valid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return 'A senha deve ter no mínimo 8 caracteres.';
  if (!/[A-Z]/.test(password)) return 'A senha deve conter pelo menos uma letra maiúscula.';
  if (!/[0-9]/.test(password)) return 'A senha deve conter pelo menos um número.';
  return null;
}

/**
 * Shared CSS for password toggle and strength hints.
 */
export const passwordToggleCSS = `
  .password-input-wrap { position: relative; }
  .password-eye-toggle { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; color: #888780; padding: 0; display: flex; align-items: center; }
  .password-strength-hints { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
  .password-hint-pill { font-size: 11px; padding: 3px 8px; border-radius: 20px; background: #f1efe8; color: #888780; display: flex; align-items: center; gap: 4px; transition: background 0.15s, color 0.15s; }
  .password-hint-pill.met { background: #eaf3de; color: #3b6d11; }
  .password-hint-pill svg { width: 10px; height: 10px; }
`;
