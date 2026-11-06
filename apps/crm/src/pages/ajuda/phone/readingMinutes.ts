/** Reading time in minutes at 200 words per minute, at least 1 (same rule as ArticleCard). */
export function readingMinutes(plainText: string): number {
  return Math.max(1, Math.ceil(plainText.trim().split(/\s+/).length / 200));
}
