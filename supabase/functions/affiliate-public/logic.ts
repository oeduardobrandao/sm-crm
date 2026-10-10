// Pure pieces of affiliate-public: validation, code/token generation and the dashboard
// shaping. No I/O here so everything is unit-testable.

export const ACCESS_TOKEN_TTL_DAYS = 180;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** 32 random bytes, base64url without padding = 43 chars. */
export const ACCESS_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
/** Sem 0/o/1/l/i para o código ser fácil de ditar. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

function onlyDigits(v: string): string {
  return v.replace(/\D+/g, "");
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function normalizeNome(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const nome = raw.trim().replace(/\s+/g, " ");
  if (nome.length < 1 || nome.length > 120) return null;
  return nome;
}

/** Telefone opcional: vazio → null; senão 10 a 13 dígitos. undefined = inválido. */
export function normalizeTelefone(raw: unknown): string | null | undefined {
  if (raw == null || (typeof raw === "string" && raw.trim() === "")) return null;
  if (typeof raw !== "string") return undefined;
  const digits = onlyDigits(raw);
  return /^[0-9]{10,13}$/.test(digits) ? digits : undefined;
}

export interface SignupInput {
  nome: string;
  email: string;
  telefone: string | null;
}

export function validateSignup(body: Record<string, unknown>): Validated<SignupInput> {
  const nome = normalizeNome(body.nome);
  if (!nome) return { ok: false, error: "Informe seu nome." };
  const email = normalizeEmail(body.email);
  if (!email) return { ok: false, error: "Informe um e-mail válido." };
  const telefone = normalizeTelefone(body.telefone);
  if (telefone === undefined) return { ok: false, error: "Telefone inválido." };
  if (body.aceite_termos !== true) {
    return { ok: false, error: "É preciso aceitar os termos do programa." };
  }
  return { ok: true, value: { nome, email, telefone } };
}

/** Primeiro nome sem acento (até 8 letras) + 4 caracteres aleatórios: "ana7k3f". */
export function buildAffiliateCode(nome: string, randomBytes: Uint8Array): string {
  let base = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/\s+/)[0]
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  if (base.length < 2) base = "mesaas";
  let suffix = "";
  for (let i = 0; i < 4; i++) suffix += CODE_ALPHABET[randomBytes[i] % CODE_ALPHABET.length];
  return base + suffix;
}

export function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function tokenExpiry(now: Date): Date {
  return new Date(now.getTime() + ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------------------
// Dashboard shaping

export type ReferralSituacao = "cadastrado" | "trial" | "ativo" | "outro_meio" | "cancelado";

/**
 * Situação de uma indicação a partir da assinatura do workspace. "outro_meio" = assinatura
 * em vigor fora do Stripe (Pagar.me), que não gera comissão.
 */
export function referralSituacao(
  sub: { provider: string | null; status: string | null } | null | undefined,
): ReferralSituacao {
  if (!sub || !sub.status) return "cadastrado";
  const inForce = ["trialing", "active", "past_due"].includes(sub.status);
  if (sub.provider && sub.provider !== "stripe") return inForce ? "outro_meio" : "cancelado";
  if (sub.status === "trialing") return "trial";
  if (sub.status === "active" || sub.status === "past_due") return "ativo";
  if (sub.status === "incomplete") return "cadastrado";
  return "cancelado";
}

export type CommissionSituacao = "pendente" | "disponivel" | "estornada" | "contestada";

export function commissionSituacao(
  c: { net_cents: number; disputed: boolean; available_at: string },
  now: Date,
): CommissionSituacao {
  if (c.disputed) return "contestada";
  if (c.net_cents <= 0) return "estornada";
  return Date.parse(c.available_at) > now.getTime() ? "pendente" : "disponivel";
}

export interface SummaryRow {
  referrals_count: number;
  trialing_count: number;
  paying_count: number;
  pending_cents: number | string;
  released_cents: number | string;
  paid_out_cents: number | string;
  available_cents: number | string;
  lifetime_cents: number | string;
}

/** bigint chega como string pelo PostgREST. */
export function shapeSummary(row: Partial<SummaryRow> | null | undefined) {
  const n = (v: unknown) => {
    const x = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
    return Number.isFinite(x) ? x : 0;
  };
  return {
    referrals_count: n(row?.referrals_count),
    trialing_count: n(row?.trialing_count),
    paying_count: n(row?.paying_count),
    pending_cents: n(row?.pending_cents),
    available_cents: n(row?.available_cents),
    paid_out_cents: n(row?.paid_out_cents),
    lifetime_cents: n(row?.lifetime_cents),
  };
}
