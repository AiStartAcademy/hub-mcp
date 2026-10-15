import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config.js";
import type {
  HubClient,
  LessonContentUpdateItem,
  LessonQuizQuestion,
} from "../src/hub-client.js";
import { PreviewStore } from "../src/preview-store.js";
import {
  lessonContentUpdateSchema,
  makeLessonContentUpdateHandler,
  type LessonContentUpdateInput,
} from "../src/tools/lesson-content-update.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

function extractPreviewId(text: string): string {
  const previewId = text.match(/previewId: (pv_\w+)/)?.[1];
  expect(previewId).toBeTruthy();
  return previewId as string;
}

function input(overrides: Partial<LessonContentUpdateInput> = {}): LessonContentUpdateInput {
  return {
    items: [
      {
        lessonId: "lesson_1",
        posterUrl: "https://cdn.example.com/a.jpg",
      },
    ],
    dryRun: true,
    ...overrides,
  };
}

function quizQuestions(
  overrides: Partial<LessonQuizQuestion> = {}
): LessonQuizQuestion[] {
  return [
    {
      question: "What is the main idea of this lesson?",
      options: ["Automation", "Gardening"],
      correct_answer: "Automation",
      explanation: "The lesson focuses on automation.",
      ...overrides,
    },
  ];
}

describe("lesson_content_update schema", () => {
  test("accepts an absolute https posterUrl", () => {
    const parsed = lessonContentUpdateSchema.parse(input());
    expect(parsed.items[0]?.posterUrl).toBe("https://cdn.example.com/a.jpg");
  });

  test("rejects non-https or invalid posterUrl values", () => {
    for (const posterUrl of ["http://x", "ftp://x", "/relative/path", "", "not a url"]) {
      const parsed = lessonContentUpdateSchema.safeParse(input({ items: [{ lessonId: "lesson_1", posterUrl }] }));
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues[0]?.message).toBe("posterUrl must be an absolute https:// URL.");
      }
    }
  });

  test("accepts captionsUrl and quizQuestions", () => {
    const parsed = lessonContentUpdateSchema.parse(input({
      items: [
        {
          lessonId: "lesson_1",
          captionsUrl: "https://cdn.example.com/a.vtt",
          quizQuestions: quizQuestions(),
        },
      ],
    }));

    expect(parsed.items[0]?.captionsUrl).toBe("https://cdn.example.com/a.vtt");
    expect(parsed.items[0]?.quizQuestions?.[0]?.correct_answer).toBe("Automation");
  });

  test("rejects quizQuestions whose correct_answer is not in options", () => {
    const parsed = lessonContentUpdateSchema.safeParse(input({
      items: [
        {
          lessonId: "lesson_1",
          quizQuestions: quizQuestions({ correct_answer: "Finance" }),
        },
      ],
    }));

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("correct_answer must be one of options.");
      expect(parsed.error.issues[0]?.path).toEqual(["items", 0, "quizQuestions", 0, "correct_answer"]);
    }
  });

  test("rejects non-https audioUrl values", () => {
    const parsed = lessonContentUpdateSchema.safeParse(input({
      items: [{ lessonId: "lesson_1", audioUrl: "http://cdn.example.com/a.mp3" }],
    }));

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("audioUrl must be an absolute https:// URL.");
    }
  });
});

describe("lesson_content_update preview and commit", () => {
  test("posterUrl alone satisfies the content-field guard and appears in preview", async () => {
    const hub = {
      updateLessonContent: async () => ({
        items: [],
      }),
    } as unknown as HubClient;
    const handler = makeLessonContentUpdateHandler(hub, config, new PreviewStore<LessonContentUpdateItem[]>());

    const preview = await handler(input());

    expect(preview).toContain("PREVIEW · target: LOCAL");
    expect(preview).toContain('posterUrl: "https://cdn.example.com/a.jpg"');
    expect(preview).not.toContain("Refused: every item needs at least one content field to write.");
  });

  test("each new field alone satisfies the content-field guard", async () => {
    const hub = {
      updateLessonContent: async () => ({
        items: [],
      }),
    } as unknown as HubClient;
    const handler = makeLessonContentUpdateHandler(hub, config, new PreviewStore<LessonContentUpdateItem[]>());

    const cases: LessonContentUpdateItem[] = [
      {
        lessonId: "lesson_audio",
        audioUrl: "https://cdn.example.com/audio.mp3",
      },
      {
        lessonId: "lesson_captions",
        captionsUrl: "https://cdn.example.com/captions.vtt",
      },
      {
        lessonId: "lesson_quiz",
        quizQuestions: quizQuestions(),
      },
    ];

    for (const item of cases) {
      const preview = await handler({ items: [item], dryRun: true });
      expect(preview).toContain("PREVIEW · target: LOCAL");
      expect(preview).not.toContain("Refused: every item needs at least one content field to write.");
    }
  });

  test("dry-run preview renders quiz question count and first question", async () => {
    const hub = {
      updateLessonContent: async () => ({
        items: [],
      }),
    } as unknown as HubClient;
    const handler = makeLessonContentUpdateHandler(hub, config, new PreviewStore<LessonContentUpdateItem[]>());

    const preview = await handler({
      items: [
        {
          lessonId: "lesson_1",
          quizQuestions: [
            quizQuestions()[0] as LessonQuizQuestion,
            {
              question: "Which step comes next?",
              options: ["Review", "Ignore"],
              correct_answer: "Review",
            },
          ],
        },
      ],
      dryRun: true,
    });

    expect(preview).toContain('quizQuestions: 2 question(s) · first: "What is the main idea of this lesson?"');
  });

  test("confirm forwards new lesson content fields through the stored preview payload", async () => {
    const calls: LessonContentUpdateItem[][] = [];
    const hub = {
      updateLessonContent: async (items: LessonContentUpdateItem[]) => {
        calls.push(items);
        return {
          items: [
            {
              lessonId: "lesson_1",
              zoomFileId: null,
              changed: {
                posterUrl: { from: null, to: "https://cdn.example.com/a.jpg" },
                audioUrl: { from: null, to: "https://cdn.example.com/a.mp3" },
                captionsUrl: { from: null, to: "https://cdn.example.com/a.vtt" },
                quizQuestions: {
                  from: null,
                  to: quizQuestions(),
                },
              },
              unchanged: [],
            },
          ],
        };
      },
    } as unknown as HubClient;
    const handler = makeLessonContentUpdateHandler(hub, config, new PreviewStore<LessonContentUpdateItem[]>());

    const preview = await handler(input({
      items: [
        {
          lessonId: "lesson_1",
          posterUrl: "https://cdn.example.com/a.jpg",
          audioUrl: "https://cdn.example.com/a.mp3",
          captionsUrl: "https://cdn.example.com/a.vtt",
          quizQuestions: quizQuestions(),
        },
      ],
    }));
    const previewId = extractPreviewId(preview);
    const committed = await handler({ previewId, confirm: true } as LessonContentUpdateInput);

    expect(committed).toContain("COMMITTED · target: LOCAL");
    expect(calls).toEqual([
      [
        {
          lessonId: "lesson_1",
          posterUrl: "https://cdn.example.com/a.jpg",
          audioUrl: "https://cdn.example.com/a.mp3",
          captionsUrl: "https://cdn.example.com/a.vtt",
          quizQuestions: quizQuestions(),
        },
      ],
    ]);
  });
});
