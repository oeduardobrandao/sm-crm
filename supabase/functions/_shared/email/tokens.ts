/**
 * Visual tokens for every transactional e-mail (spec 2026-10-10-email-redesign §3).
 * Values come from the Mesaas Design System; e-mail clients need literal hex,
 * so nothing here is a CSS variable.
 */
export const EMAIL = {
  page: "#f5f6f8",
  card: "#ffffff",
  border: "#e5e7eb",
  divider: "#eef0f3",
  ink: "#12151a",
  text: "#374151",
  muted: "#4b5563",
  outlineBorder: "#d1d5db",
  brandMark: "#ffbf30",
  calloutBg: "#f5f6f8",
  alertBg: "#fee2e2",
  alertBorder: "#fecaca",
  alertText: "#b91c1c",
  dangerDot: "#dc2626",
  // Report KPI deltas. Positive was #16a34a (3.3:1, fails AA); badge-success-fg passes.
  positive: "#15803d",
  deltaNeutral: "#6b7280",
} as const;

export const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Helvetica, Arial, sans-serif";

/** Same asset in every environment; `www.` because the bare domain answers 308. */
export const EMAIL_LOGO_URL = "https://www.mesaas.com.br/logo-black-email.png";

export const DEFAULT_BRAND_COLOR = "#eab308";

export type BadgeTone = "danger" | "warning" | "info" | "success" | "neutral";

export const BADGE_TONES: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  danger: { bg: "#fee2e2", fg: "#b91c1c", border: "#fecaca" },
  warning: { bg: "#fef3c7", fg: "#b45309", border: "#fde68a" },
  info: { bg: "#dbeafe", fg: "#1d4ed8", border: "#bfdbfe" },
  success: { bg: "#dcfce7", fg: "#15803d", border: "#bbf7d0" },
  neutral: { bg: "#f1f5f9", fg: "#475569", border: "#e2e8f0" },
};

/** `workflow_posts.tipo` CHECK: feed | reels | stories | carrossel. */
export const POST_TIPOS: Record<string, { label: string; color: string }> = {
  feed: { label: "Feed", color: "#eab308" },
  carrossel: { label: "Carrossel", color: "#3ecf8e" },
  reels: { label: "Reels", color: "#e1306c" },
  stories: { label: "Stories", color: "#42c8f5" },
};

export const POST_TIPO_FALLBACK = { label: "Post", color: "#64748b" };
