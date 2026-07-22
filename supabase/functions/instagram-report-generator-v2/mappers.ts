/**
 * Pure mappers that turn `instagram_analytics_cache` blobs into the shapes the
 * report renderer consumes.
 *
 * They live outside `index.ts` because that module calls `Deno.serve()` and throws
 * on missing env vars at import time, which makes it untestable. Everything here is
 * side-effect free and covered by `mappers.test.ts`.
 */

import type {
  AudienceData,
  BestTimeSlot,
} from "../_shared/report-template/types.ts";

// ---------------------------------------------------------------------------
// Audience mapping
// ---------------------------------------------------------------------------

const COUNTRY_NAMES: Record<string, string> = {
  BR: "Brasil",
  US: "Estados Unidos",
  PT: "Portugal",
  AR: "Argentina",
  MX: "México",
  CO: "Colômbia",
  CL: "Chile",
  PE: "Peru",
  UY: "Uruguai",
  PY: "Paraguai",
  EC: "Equador",
  VE: "Venezuela",
  BO: "Bolívia",
  ES: "Espanha",
  FR: "França",
  DE: "Alemanha",
  IT: "Itália",
  GB: "Reino Unido",
  CA: "Canadá",
  JP: "Japão",
  IN: "Índia",
  AU: "Austrália",
  AO: "Angola",
  MZ: "Moçambique",
  CV: "Cabo Verde",
};

export const MAX_REPORT_CITIES = 8;
export const MAX_REPORT_AGE_RANGES = 6;
export const MAX_REPORT_COUNTRIES = 5;

/** Cache blobs are untrusted JSON: anything that is not an array is treated as empty. */
function asRows(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

/**
 * Maps the cached demographics blob into `AudienceData`.
 *
 * The renderer labels these panels "Principais cidades / faixas etárias / países",
 * which asserts the rows are the LEADING ones — so every list is sorted by share
 * descending BEFORE it is capped. (Upstream order is not a ranking: age buckets
 * arrive chronologically.)
 *
 * Percentages are normalised over the FULL list, not over the retained subset:
 * each bar then means "this segment's share of the whole audience sample", which
 * stays true regardless of the cap. Normalising over the kept rows would inflate
 * them to sum to 100% and overstate every segment.
 */
export function mapAudience(demographics: any): AudienceData | null {
  if (!demographics || typeof demographics !== "object") return null;

  const cityWeight = (c: any) => c?.count ?? c?.pct ?? 0;
  // Age data is stored as "age_gender" with an "age_range" field, or as
  // "age_ranges" with a "range" field.
  const ageWeight = (a: any) =>
    (a?.male ?? 0) + (a?.female ?? 0) + (a?.count ?? a?.pct ?? 0);
  const countryWeight = (c: any) => c?.count ?? c?.pct ?? 0;

  const sortDesc = <T>(rows: T[], weight: (row: T) => number): T[] =>
    [...rows].sort((a, b) => weight(b) - weight(a));
  const sum = <T>(rows: T[], weight: (row: T) => number): number =>
    rows.reduce((s, r) => s + weight(r), 0) || 1;

  const allCities = sortDesc<any>(asRows(demographics.cities), cityWeight);
  const cityTotal = sum(allCities, cityWeight);

  const allAges = sortDesc<any>(
    asRows(demographics.age_gender ?? demographics.age_ranges),
    ageWeight,
  );
  const ageTotal = sum(allAges, ageWeight);

  const allCountries = sortDesc<any>(
    asRows(demographics.countries),
    countryWeight,
  );
  const countryTotal = sum(allCountries, countryWeight);

  return {
    gender_split: {
      female: demographics.gender_split?.female ?? 0,
      male: demographics.gender_split?.male ?? 0,
    },
    top_cities: allCities.slice(0, MAX_REPORT_CITIES).map((c: any) => ({
      name: c.name,
      pct: (cityWeight(c) / cityTotal) * 100,
    })),
    top_age_ranges: allAges.slice(0, MAX_REPORT_AGE_RANGES).map((a: any) => ({
      range: a.age_range || a.range || a.name,
      pct: (ageWeight(a) / ageTotal) * 100,
    })),
    top_countries: allCountries.slice(0, MAX_REPORT_COUNTRIES).map((
      c: any,
    ) => ({
      name: COUNTRY_NAMES[c.code] || c.name || c.code || "—",
      pct: (countryWeight(c) / countryTotal) * 100,
    })),
  };
}

// ---------------------------------------------------------------------------
// Best-times mapping
// ---------------------------------------------------------------------------

/**
 * Day labels indexed the way `instagram-analytics` writes them: it derives the
 * index with `(date.getDay() + 6) % 7`, so 0 = Monday. These strings are the keys
 * the renderer's DAY_INDEX map understands — `mappers.test.ts` asserts that
 * round-trip so the two ends cannot silently drift apart.
 */
export const BEST_TIME_DAY_LABELS = [
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sab",
  "Dom",
];

/**
 * Every string form we are willing to accept for a weekday, mapped to the
 * Monday=0 index. Anything outside this table is dropped rather than passed
 * through: the renderer resolves an unknown day with `?? 0`, so an unrecognised
 * label would be painted as Monday and the client would read a wrong day.
 */
const DAY_ALIAS_INDEX: Record<string, number> = {
  seg: 0,
  ter: 1,
  qua: 2,
  qui: 3,
  sex: 4,
  sab: 5,
  dom: 6,
  segunda: 0,
  terça: 1,
  terca: 1,
  quarta: 2,
  quinta: 3,
  sexta: 4,
  sábado: 5,
  sabado: 5,
  domingo: 6,
  mon: 0,
  tue: 1,
  wed: 2,
  thu: 3,
  fri: 4,
  sat: 5,
  sun: 6,
};

/**
 * Normalises a raw `day` (numeric index or label) to one of
 * `BEST_TIME_DAY_LABELS`. Returns null for anything unrecognised.
 */
export function dayLabel(day: unknown): string | null {
  if (typeof day === "string") {
    const key = day.trim().toLowerCase();
    const idx = DAY_ALIAS_INDEX[key];
    if (idx !== undefined) return BEST_TIME_DAY_LABELS[idx];
    // A stringified index ("3") is still a valid index; anything else is dropped.
    return /^[0-6]$/.test(key) ? BEST_TIME_DAY_LABELS[Number(key)] : null;
  }
  // `Number(null)` is 0 and `Number([])` is 0 — either would silently become
  // Monday, so only a genuine number is accepted here.
  if (typeof day !== "number") return null;
  if (!Number.isInteger(day) || day < 0 || day > 6) return null;
  return BEST_TIME_DAY_LABELS[day];
}

/**
 * Maps the `best_times` analytics cache entry into `BestTimeSlot[]`.
 *
 * `instagram-analytics` caches an OBJECT — `{ heatmap, counts, topSlots, ... }` —
 * where `heatmap[day][hour]` is the average engagement rate and `counts[day][hour]`
 * how many posts fed it. The previous `Array.isArray()` guard therefore always fell
 * through to `[]` and the renderer's whole heatmap section was silently dropped.
 *
 * The full grid is emitted (every slot that actually had a post), not just
 * `topSlots`: the renderer paints a 7-day × 8h–21h grid and derives its own ramp
 * and top-3 chips from what it is given.
 */
export function mapBestTimes(raw: unknown): BestTimeSlot[] {
  if (!raw) return [];

  // SPECULATIVE defence-in-depth, not an observed legacy shape: no writer has ever
  // been seen caching a flat array of slots. Kept so a future/hand-written cache row
  // degrades instead of blanking the section.
  if (Array.isArray(raw)) {
    return raw.flatMap((bt: any) => {
      const day = dayLabel(bt?.day);
      const hour = Number(bt?.hour);
      if (day === null || !Number.isInteger(hour)) return [];
      return [{
        day,
        hour,
        avg_engagement: Number(
          bt?.avg_engagement ?? bt?.value ?? bt?.engagement ?? 0,
        ) || 0,
      }];
    });
  }

  if (typeof raw !== "object") return [];

  const obj = raw as {
    heatmap?: unknown;
    counts?: unknown;
    topSlots?: unknown;
  };
  const heatmap = obj.heatmap;
  const counts = obj.counts;

  if (Array.isArray(heatmap)) {
    const slots: BestTimeSlot[] = [];
    for (let d = 0; d < heatmap.length && d < 7; d++) {
      const hours = heatmap[d];
      if (!Array.isArray(hours)) continue;
      const dayCounts = Array.isArray(counts) && Array.isArray(counts[d])
        ? counts[d] as number[]
        : null;
      for (let h = 0; h < hours.length && h < 24; h++) {
        // Only slots backed by a real post; without `counts`, a non-zero average
        // is the best available signal that the slot was actually used.
        const used = dayCounts ? (dayCounts[h] || 0) > 0 : Number(hours[h]) > 0;
        if (!used) continue;
        slots.push({
          day: BEST_TIME_DAY_LABELS[d],
          hour: h,
          avg_engagement: Number(hours[h]) || 0,
        });
      }
    }
    return slots;
  }

  // SPECULATIVE defence-in-depth, not an observed legacy shape: every cache row the
  // current writer produces carries `heatmap`/`counts` alongside `topSlots`, so this
  // branch is unreachable in practice.
  if (Array.isArray(obj.topSlots)) {
    return (obj.topSlots as any[]).flatMap((s) => {
      const day = dayLabel(s?.day);
      const hour = Number(s?.hour);
      if (day === null || !Number.isInteger(hour)) return [];
      return [{
        day,
        hour,
        avg_engagement: Number(s?.value ?? s?.avg_engagement ?? 0) || 0,
      }];
    });
  }

  return [];
}
