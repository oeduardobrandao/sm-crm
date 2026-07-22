import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BEST_TIME_DAY_LABELS,
  dayLabel,
  mapAudience,
  mapBestTimes,
} from "./mappers.ts";
import { DAY_INDEX } from "../_shared/report-template/render.ts";

// ---------------------------------------------------------------------------
// Weekday mapping — the silent-failure risk
// ---------------------------------------------------------------------------

/**
 * `instagram-analytics` writes `(date.getDay() + 6) % 7`, so 0 = Monday. If this
 * ever drifts, every recommended posting time names the wrong day and the report
 * still looks perfectly fine — hence the explicit table.
 */
const WRITER_INDEX_TO_LABEL: [number, string][] = [
  [0, "Seg"],
  [1, "Ter"],
  [2, "Qua"],
  [3, "Qui"],
  [4, "Sex"],
  [5, "Sab"],
  [6, "Dom"],
];

Deno.test("dayLabel maps all seven writer indices to the expected label", () => {
  for (const [idx, label] of WRITER_INDEX_TO_LABEL) {
    assertEquals(dayLabel(idx), label, `writer index ${idx}`);
  }
  assertEquals(BEST_TIME_DAY_LABELS.length, 7);
});

Deno.test("every emitted day label round-trips through the renderer's DAY_INDEX", () => {
  for (const [idx, label] of WRITER_INDEX_TO_LABEL) {
    const rendererIdx = DAY_INDEX[label.toLowerCase()];
    // `dayIndex()` falls back to `?? 0`, so an unknown key would silently become
    // Monday. Assert the key EXISTS, not just that the value matches.
    assert(
      rendererIdx !== undefined,
      `renderer DAY_INDEX has no key for "${label}"`,
    );
    assertEquals(rendererIdx, idx, `label "${label}" must be day ${idx}`);
  }
});

Deno.test("mapBestTimes labels grid rows with the same convention", () => {
  // One post on every weekday, at hour 10.
  const heatmap = Array.from(
    { length: 7 },
    (_, d) => Array.from({ length: 24 }, (_, h) => (h === 10 ? d + 1 : 0)),
  );
  const counts = Array.from(
    { length: 7 },
    () => Array.from({ length: 24 }, (_, h) => (h === 10 ? 1 : 0)),
  );

  const slots = mapBestTimes({ heatmap, counts });
  assertEquals(slots.length, 7);
  for (const [idx, label] of WRITER_INDEX_TO_LABEL) {
    const slot = slots[idx];
    assertEquals(slot.day, label);
    assertEquals(DAY_INDEX[slot.day.toLowerCase()], idx);
    assertEquals(slot.hour, 10);
    assertEquals(slot.avg_engagement, idx + 1);
  }
});

Deno.test("dayLabel drops unrecognised day strings instead of passing them through", () => {
  assertEquals(dayLabel("Lunes"), null);
  assertEquals(dayLabel("qualquer coisa"), null);
  assertEquals(dayLabel(""), null);
  assertEquals(dayLabel("   "), null);
  assertEquals(dayLabel(7), null);
  assertEquals(dayLabel(-1), null);
  assertEquals(dayLabel(2.5), null);
  assertEquals(dayLabel(null), null);
  assertEquals(dayLabel(undefined), null);
  // Recognised aliases normalise to the canonical label.
  assertEquals(dayLabel("sábado"), "Sab");
  assertEquals(dayLabel("QUINTA"), "Qui");
  assertEquals(dayLabel(" wed "), "Qua");
  // A stringified index is still an index.
  assertEquals(dayLabel("3"), "Qui");
  assertEquals(dayLabel("9"), null);
});

// ---------------------------------------------------------------------------
// Real cached shape
// ---------------------------------------------------------------------------

/** The object `instagram-analytics` actually writes under cache_key "best_times". */
function realCacheShape() {
  const heatmap = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const counts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const used: [number, number, number, number][] = [
    // [day, hour, avgEngagement, postCount]
    [0, 9, 3.2, 2],
    [1, 19, 7.8, 4],
    [2, 12, 5.1, 1],
    [3, 6, 9.9, 1],
    [4, 20, 6.4, 3],
    [6, 8, 1.9, 1],
  ];
  for (const [d, h, eng, n] of used) {
    heatmap[d][h] = eng;
    counts[d][h] = n;
  }
  return {
    heatmap,
    counts,
    topSlots: [
      { day: 3, hour: 6, value: 9.9 },
      { day: 1, hour: 19, value: 7.8 },
      { day: 4, hour: 20, value: 6.4 },
    ],
    totalPosts: 12,
    labels_days: ["Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"],
    labels_hours: Array.from({ length: 24 }, (_, h) => `${h}h`),
  };
}

Deno.test("mapBestTimes turns the real object-shaped cache into a non-empty slot list", () => {
  const slots = mapBestTimes(realCacheShape());

  // The old `Array.isArray(raw)` guard produced [] for this exact input.
  assert(slots.length > 0, "object-shaped cache must not map to an empty list");
  assertEquals(slots.length, 6);
  assertEquals(slots[0], { day: "Seg", hour: 9, avg_engagement: 3.2 });
  assertEquals(slots[1], { day: "Ter", hour: 19, avg_engagement: 7.8 });
  assertEquals(slots[5], { day: "Dom", hour: 8, avg_engagement: 1.9 });
  // Only slots backed by a real post are emitted.
  assertEquals(slots.filter((s) => s.day === "Sab").length, 0);
});

Deno.test("mapBestTimes renames topSlots `value` to `avg_engagement`", () => {
  // Legacy/speculative branch: no heatmap, only topSlots with `value`.
  const slots = mapBestTimes({
    topSlots: [
      { day: 3, hour: 6, value: 9.9 },
      { day: 1, hour: 19, value: 7.8 },
    ],
  });
  assertEquals(slots, [
    { day: "Qui", hour: 6, avg_engagement: 9.9 },
    { day: "Ter", hour: 19, avg_engagement: 7.8 },
  ]);
  // No `value` key survives onto the renderer-facing shape.
  assert(!Object.hasOwn(slots[0], "value"));
});

Deno.test("mapBestTimes accepts `value` on the flat-array branch too", () => {
  const slots = mapBestTimes([{ day: 2, hour: 15, value: 4.5 }]);
  assertEquals(slots, [{ day: "Qua", hour: 15, avg_engagement: 4.5 }]);
});

Deno.test("mapBestTimes returns [] for malformed / empty input instead of throwing", () => {
  assertEquals(mapBestTimes(null), []);
  assertEquals(mapBestTimes(undefined), []);
  assertEquals(mapBestTimes([]), []);
  assertEquals(mapBestTimes({}), []);
  assertEquals(mapBestTimes("nonsense"), []);
  assertEquals(mapBestTimes(42), []);
  assertEquals(mapBestTimes({ heatmap: "not-an-array" }), []);
  assertEquals(mapBestTimes({ heatmap: null, counts: null }), []);
  assertEquals(mapBestTimes({ heatmap: [null, 5, {}] }), []);
  assertEquals(mapBestTimes({ topSlots: "nope" }), []);
  // Rows with an unusable day/hour are dropped, not emitted with a wrong day.
  assertEquals(mapBestTimes([{ day: 99, hour: 1 }, { day: 1, hour: "x" }]), []);
});

// ---------------------------------------------------------------------------
// Audience mapping
// ---------------------------------------------------------------------------

/** 10 cities deliberately out of order; total = 1255. */
function unsortedDemographics() {
  return {
    gender_split: { female: 71, male: 29 },
    cities: [
      { name: "Belo Horizonte", count: 120 },
      { name: "São Paulo", count: 500 },
      { name: "Manaus", count: 10 },
      { name: "Recife", count: 60 },
      { name: "Rio de Janeiro", count: 300 },
      { name: "Natal", count: 15 },
      { name: "Curitiba", count: 40 },
      { name: "Salvador", count: 90 },
      { name: "Porto Alegre", count: 50 },
      { name: "Fortaleza", count: 70 },
    ],
    // Chronological upstream order — NOT a ranking.
    age_gender: [
      { age_range: "13-17", male: 1, female: 2 },
      { age_range: "18-24", male: 20, female: 45 },
      { age_range: "25-34", male: 70, female: 180 },
      { age_range: "35-44", male: 40, female: 100 },
      { age_range: "45-54", male: 15, female: 30 },
      { age_range: "55-64", male: 5, female: 10 },
      { age_range: "65+", male: 2, female: 3 },
    ],
    countries: [
      { code: "US", count: 50 },
      { code: "BR", count: 750 },
      { code: "ES", count: 7 },
      { code: "PT", count: 25 },
      { code: "AR", count: 10 },
      { code: "XX", count: 3 },
    ],
  };
}

Deno.test("mapAudience sorts every list descending before slicing", () => {
  const a = mapAudience(unsortedDemographics())!;
  assert(a !== null);

  assertEquals(a.top_cities.map((c) => c.name), [
    "São Paulo",
    "Rio de Janeiro",
    "Belo Horizonte",
    "Salvador",
    "Fortaleza",
    "Recife",
    "Porto Alegre",
    "Curitiba",
  ]);
  assertEquals(a.top_age_ranges.map((r) => r.range), [
    "25-34",
    "35-44",
    "18-24",
    "45-54",
    "55-64",
    "65+",
  ]);
  assertEquals(a.top_countries!.map((c) => c.name), [
    "Brasil",
    "Estados Unidos",
    "Portugal",
    "Argentina",
    "Espanha",
  ]);

  for (const list of [a.top_cities, a.top_age_ranges, a.top_countries!]) {
    for (let i = 1; i < list.length; i++) {
      assert(list[i - 1].pct >= list[i].pct, "list must be descending by pct");
    }
  }

  assertEquals(a.gender_split, { female: 71, male: 29 });
});

Deno.test("mapAudience normalises percentages over the FULL list, not the kept subset", () => {
  const a = mapAudience(unsortedDemographics())!;

  // City denominator is the full 10-city total (1255), so São Paulo = 500/1255.
  const saoPaulo = a.top_cities[0].pct;
  assertEquals(Math.round(saoPaulo * 100) / 100, 39.84);

  // The kept 8 must sum to LESS than 100% — the dropped tail (Manaus 10 + Natal 15)
  // is the difference. Normalising over the kept rows would force exactly 100.
  const keptCitySum = a.top_cities.reduce((s, c) => s + c.pct, 0);
  assert(
    keptCitySum < 100,
    `kept cities summed to ${keptCitySum}, expected <100`,
  );
  assertEquals(Math.round(keptCitySum * 100) / 100, 98.01);

  // Same rule for ages: the dropped 13-17 bucket keeps the sum under 100.
  const keptAgeSum = a.top_age_ranges.reduce((s, r) => s + r.pct, 0);
  assert(keptAgeSum < 100, `kept ages summed to ${keptAgeSum}, expected <100`);

  // And for countries: the unknown "XX" code is dropped by the cap.
  const keptCountrySum = a.top_countries!.reduce((s, c) => s + c.pct, 0);
  assert(keptCountrySum < 100);
});

Deno.test("mapAudience caps each list at its documented maximum", () => {
  const many = {
    cities: Array.from({ length: 30 }, (_, i) => ({
      name: `C${i}`,
      count: 30 - i,
    })),
    age_ranges: Array.from({ length: 20 }, (_, i) => ({
      range: `R${i}`,
      count: 20 - i,
    })),
    countries: Array.from({ length: 20 }, (_, i) => ({
      code: "BR",
      count: 20 - i,
    })),
  };
  const a = mapAudience(many)!;
  assertEquals(a.top_cities.length, 8);
  assertEquals(a.top_age_ranges.length, 6);
  assertEquals(a.top_countries!.length, 5);
});

Deno.test("mapAudience reads the age_ranges/`range` variant too", () => {
  const a = mapAudience({
    age_ranges: [
      { range: "18-24", count: 10 },
      { range: "25-34", count: 90 },
    ],
  })!;
  assertEquals(a.top_age_ranges, [
    { range: "25-34", pct: 90 },
    { range: "18-24", pct: 10 },
  ]);
});

Deno.test("mapAudience returns null for missing demographics", () => {
  assertEquals(mapAudience(null), null);
  assertEquals(mapAudience(undefined), null);
  assertEquals(mapAudience(0), null);
  assertEquals(mapAudience(""), null);
  assertEquals(mapAudience("nonsense"), null);
});

Deno.test("mapAudience returns empty lists for malformed input instead of throwing", () => {
  // Non-array lists used to blow up in `[...rows]` and fail the whole report.
  const a = mapAudience({
    cities: { "São Paulo": 500 },
    age_gender: "not-an-array",
    countries: 42,
  })!;
  assertEquals(a.top_cities, []);
  assertEquals(a.top_age_ranges, []);
  assertEquals(a.top_countries, []);
  assertEquals(a.gender_split, { female: 0, male: 0 });

  const empty = mapAudience({})!;
  assertEquals(empty.top_cities, []);
  assertEquals(empty.top_age_ranges, []);
  assertEquals(empty.top_countries, []);

  // An all-zero list must not divide by zero.
  const zeroed = mapAudience({ cities: [{ name: "A", count: 0 }] })!;
  assertEquals(zeroed.top_cities, [{ name: "A", pct: 0 }]);
});
