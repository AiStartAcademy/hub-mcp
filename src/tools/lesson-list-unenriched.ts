/**
 * lesson_list_unenriched — read-only. Lists raw Zoom-synced lessons that still
 * have no content (empty tags), so a caller can find what needs enrichment
 * without holding a local snapshot of the hub DB.
 */

import { z } from "zod";
import type { HubClient } from "../hub-client.js";

export const lessonListUnenrichedSchema = z.object({});

export type LessonListUnenrichedInput = z.infer<typeof lessonListUnenrichedSchema>;

export function makeLessonListUnenrichedHandler(hub: HubClient) {
  return async (): Promise<string> => {
    const { items, total } = await hub.listUnenrichedLessons();
    if (total === 0) return "No unenriched lessons — every zoomFileId-backed lesson has content.";

    const lines = [`${total} lesson(s) with a zoomFileId and no content yet:`, ""];
    for (const item of items) {
      lines.push(
        `— ${item.name} · lessonId ${item.lessonId} · zoomFileId ${item.zoomFileId} · ${Math.round(item.durationSec / 60)}min · ${item.programName}`
      );
    }
    return lines.join("\n");
  };
}
