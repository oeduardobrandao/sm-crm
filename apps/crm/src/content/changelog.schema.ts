import { z } from 'zod';

/** Internal route only ("/entregas", "/precos"): no protocol, no host, no query. */
export const changelogLinkSchema = z.object({
  href: z.string().regex(/^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/, 'href must be an internal path'),
  label: z.string().min(1),
});

export const changelogItemSchema = z.object({
  type: z.enum(['feature', 'improvement', 'fix']),
  area: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  pr: z.number().int().positive(),
  // Screenshot committed at public/novidades/ (attached by apply.ts, never by the LLM).
  image: z
    .string()
    .regex(
      /^\/novidades\/[a-z0-9][a-z0-9._-]*\.(png|jpe?g|webp)$/,
      'image must live in /novidades/',
    )
    .optional(),
  link: changelogLinkSchema.optional(),
});

export const changelogReleaseSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  summary: z.string().optional(),
  items: z.array(changelogItemSchema).min(1),
});

export const changelogSchema = z.object({
  // ISO 8601 UTC timestamp of the most recent PR merge evaluated, or '' when empty.
  lastMergedAt: z.string(),
  releases: z.array(changelogReleaseSchema),
});

export type ChangelogItem = z.infer<typeof changelogItemSchema>;
export type ChangelogRelease = z.infer<typeof changelogReleaseSchema>;
export type Changelog = z.infer<typeof changelogSchema>;

/** Page-safety parse: returns the releases array, or [] if the data is malformed. */
export function parseReleases(data: unknown): ChangelogRelease[] {
  const result = changelogSchema.safeParse(data);
  return result.success ? result.data.releases : [];
}
