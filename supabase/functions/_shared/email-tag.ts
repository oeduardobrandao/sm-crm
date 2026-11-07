/**
 * Resend tag values accept only ASCII letters, digits, underscore and dash.
 * Lives apart from email-classify.ts because that module imports the subject
 * constants of lifecycle-emails.ts, which sends tags: importing it back would
 * be a cycle that fails at module load (TDZ on the subject constants).
 */
export function tagValue(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, "_");
}
