import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.js";
import type { HubClient } from "../src/hub-client.js";
import {
  lessonAudioExtractSchema,
  makeLessonAudioExtractHandler,
} from "../src/tools/lesson-audio-extract.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

describe("lesson_audio_extract schema", () => {
  test("rejects an empty lessonId", () => {
    const parsed = lessonAudioExtractSchema.safeParse({ lessonId: "" });
    expect(parsed.success).toBe(false);
  });
});

describe("lesson_audio_extract handler", () => {
  test("returns a started message when the hub accepts the trigger", async () => {
    const hub = {
      extractLessonAudio: async (lessonId: string) => {
        expect(lessonId).toBe("lesson_1");
        return { started: true as const };
      },
    } as unknown as HubClient;
    const handler = makeLessonAudioExtractHandler(hub, config);

    const result = await handler({ lessonId: "lesson_1" });

    expect(result).toContain("STARTED · target: LOCAL");
    expect(result).toContain("lessonId: lesson_1");
    expect(result).toContain("runs asynchronously");
  });

  test("refuses while HUB_MCP_READONLY is enabled", async () => {
    const hub = {
      extractLessonAudio: async () => ({ started: true as const }),
    } as unknown as HubClient;
    const handler = makeLessonAudioExtractHandler(hub, { ...config, readOnly: true });

    const result = await handler({ lessonId: "lesson_1" });

    expect(result).toBe("Refused: this MCP server is running with HUB_MCP_READONLY=true.");
  });
});
