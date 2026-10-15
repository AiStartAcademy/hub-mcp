/**
 * session_series_list — read shared check-in/onboarding series and occurrences.
 *
 * This tool is deliberately read-only and carries no preview controls. Zoom join
 * links are displayed only as stored hub state; provisioning remains excluded from
 * all MCP series writes because a wrong write could desync the recurring meeting.
 */

import { z } from "zod";
import type {
  HubClient,
  SessionSeriesDetailItem,
  SessionSeriesListItem,
} from "../hub-client.js";
import { renderSeriesDays } from "./series-shared.js";

export const sessionSeriesListSchema = z.object({
  id: z.string().min(1).optional().describe("Optional series id for detail and occurrences."),
});

export type SessionSeriesListInput = z.infer<typeof sessionSeriesListSchema>;

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function scheduleText(item: SessionSeriesListItem | SessionSeriesDetailItem): string {
  const range = item.endDate ? `${dateOnly(item.startDate)} → ${dateOnly(item.endDate)}` : "rolling";
  return `${renderSeriesDays(item.days)} · ${item.startTime}–${item.endTime} ${item.timezone} · ${range}`;
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function renderListItem(item: SessionSeriesListItem): string {
  const cohortTitles = item.cohorts.map(({ cohort }) => cohort.title);
  const cohorts = `${countLabel(cohortTitles.length, "cohort", "cohorts")}: ${cohortTitles.length ? cohortTitles.join(", ") : "none"}`;
  return `${item.title} · ${item.kind} · ${item.status} · ${scheduleText(item)} · ${cohorts} · ${countLabel(item._count.occurrences, "occurrence", "occurrences")}`;
}

function renderDetail(item: SessionSeriesDetailItem): string {
  const header = `${item.title} · ${item.kind} · ${item.status} · ${scheduleText(item)}`;
  const instructor = item.instructor
    ? `${item.instructor.name ?? "unnamed"} <${item.instructor.email}>`
    : "none";
  const cohorts = item.cohorts.length
    ? item.cohorts.map(({ cohort }) => `${cohort.title} (${cohort.id})`).join(", ")
    : "none";
  const now = Date.now();
  const upcoming = item.occurrences.filter((occurrence) => {
    const timestamp = Date.parse(occurrence.date);
    return Number.isNaN(timestamp) || timestamp >= now;
  });
  const occurrences = upcoming.length
    ? upcoming.map(
        (occurrence) =>
          `  ${dateOnly(occurrence.date)} · ${occurrence.title} · ${occurrence.startTime}–${occurrence.endTime} ${occurrence.timezone} · ${occurrence.status}`
      )
    : ["  none"];

  return [
    header,
    `id: ${item.id}`,
    `instructor: ${instructor}`,
    `cohorts: ${cohorts}`,
    `zoom join link: ${item.zoomLink ?? "none — provision in the admin UI"}`,
    "upcoming occurrences:",
    ...occurrences,
  ].join("\n");
}

export function makeSessionSeriesListHandler(hub: HubClient) {
  return async (input: SessionSeriesListInput): Promise<string> => {
    if (input.id) {
      const detail = await hub.getSessionSeries(input.id);
      return renderDetail(detail.series);
    }

    const result = await hub.listSessionSeries();
    if (!result.series.length) return "No session series found.";
    return result.series.map(renderListItem).join("\n");
  };
}
