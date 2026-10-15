/**
 * Shared schedule normalization for the session-series tools.
 *
 * This mirrors hub/src/lib/seriesSchedule.ts so previews show the exact schedule
 * that will be written. The hub re-validates every request and remains the source
 * of truth; this local copy exists only to keep a bad week out of PreviewStore.
 */

export const SERIES_WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

export type SeriesWeekday = (typeof SERIES_WEEKDAYS)[number];

export function normalizeSeriesDays(input: unknown): SeriesWeekday[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(",")
      : [];

  const seen = new Set<SeriesWeekday>();
  for (const item of raw.map((value) => String(value).trim()).filter(Boolean)) {
    const code = item.toUpperCase().slice(0, 3) as SeriesWeekday;
    if (!SERIES_WEEKDAYS.includes(code)) {
      throw new Error(
        `Unrecognised weekday "${item}" — expected one of ${SERIES_WEEKDAYS.join(", ")}`
      );
    }
    seen.add(code);
  }

  if (seen.size === 0) {
    throw new Error('days is required, e.g. "MON,TUE,WED,THU,FRI"');
  }

  return SERIES_WEEKDAYS.filter((day) => seen.has(day));
}

export function renderSeriesDays(input: unknown): string {
  return normalizeSeriesDays(input).join(", ");
}
