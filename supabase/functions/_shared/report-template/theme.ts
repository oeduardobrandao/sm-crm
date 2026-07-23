// Accent resolution for report v2 — mirrors apps/hub/src/theme.ts (light mode).
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function relativeLuminance(hex: string): number {
  const int = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(int >> 16) & 255, (int >> 8) & 255, int & 255].map((c) => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function resolveAccent(
  hex: string | null | undefined,
): { acc: string; accFg: string } {
  let acc = hex && HEX_RE.test(hex) ? hex : "#171717";
  if (relativeLuminance(acc) > 0.85) acc = "#171717"; // unreadable on light paper
  const accFg = relativeLuminance(acc) > 0.55 ? "#171717" : "#ffffff";
  return { acc, accFg };
}
