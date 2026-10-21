/**
 * Sessão do painel do afiliado. O token de sessão (30 dias) vem da troca do link mágico e fica
 * no localStorage; quando o navegador bloqueia o storage (aba privada, cota cheia), ele fica só
 * em memória nesta aba, e o painel avisa que recarregar ou voltar do Stripe pede novo link.
 */
const KEY = 'mesaas:affiliate-session';

let memory: string | null = null;
let persisted = false;

export function readSession(): string | null {
  if (memory) return memory;
  try {
    const stored = window.localStorage.getItem(KEY);
    if (stored) {
      memory = stored;
      persisted = true;
    }
  } catch {
    // Storage bloqueado: só a memória vale.
  }
  return memory;
}

/** Guarda a sessão. Devolve false quando só ficou em memória. */
export function saveSession(token: string): boolean {
  memory = token;
  try {
    window.localStorage.setItem(KEY, token);
    persisted = true;
  } catch {
    persisted = false;
  }
  return persisted;
}

export function clearSession(): void {
  memory = null;
  persisted = false;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nada a limpar
  }
}

export function isSessionPersisted(): boolean {
  return persisted;
}
