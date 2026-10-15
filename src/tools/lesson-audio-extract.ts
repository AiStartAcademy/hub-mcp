/**
 * lesson_audio_extract — one-step, non-destructive trigger that tells the hub
 * to start extracting audio for an existing lesson asynchronously.
 */

import { z } from "zod";
import type { HubClient } from "../hub-client.js";
import type { Config } from "../config.js";

const lessonAudioExtractResponseSchema = z.object({
  started: z.literal(true),
});

export const lessonAudioExtractSchema = z.object({
  lessonId: z.string().min(1),
});

export type LessonAudioExtractInput = z.infer<typeof lessonAudioExtractSchema>;

export function makeLessonAudioExtractHandler(hub: HubClient, config: Config) {
  return async (input: LessonAudioExtractInput): Promise<string> => {
    if (config.readOnly) {
      return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
    }

    lessonAudioExtractResponseSchema.parse(await hub.extractLessonAudio(input.lessonId));

    return [
      `STARTED · target: ${config.envLabel}`,
      `lessonId: ${input.lessonId}`,
      "Audio extraction was triggered on the hub and runs asynchronously.",
    ].join("\n");
  };
}
