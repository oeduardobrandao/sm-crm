/** A stable colour per workspace for its avatar letter (white text on it). */
export function avatarColor(name: string): string {
  let hue = 0;
  for (let i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${hue} 45% 36%)`;
}

/** The avatar letter: the name's first character, or "?" for a blank name. */
export function avatarLetter(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}
