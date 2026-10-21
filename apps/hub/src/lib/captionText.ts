/**
 * Post scripts (`conteudo_plain`) for feed/reels often hold internal hook/notes
 * before a "LEGENDA" marker; only the text after it is the caption the client
 * sees. Returns that text, or the whole string when there is no marker.
 * Same rule as InstagramPostCard/StoryPostCard (and `deriveCaption` on the
 * hub-post-grid-dialog branch), kept in one place.
 */
export function extractCaptionFromScript(text: string): string {
  const legendaIdx = text.toUpperCase().indexOf('LEGENDA');
  return legendaIdx !== -1
    ? text
        .slice(legendaIdx + 'LEGENDA'.length)
        .replace(/^[:\s\n]+/, '')
        .trim()
    : text;
}
