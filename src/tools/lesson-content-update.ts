/**
 * lesson_content_update — batch-preview then batch-commit, like cohort_create's tree writes.
 *
 * Fills intro/text/tags/timecodes/name onto EXISTING raw Lesson rows (the
 * "Recording - M/D/YYYY" placeholders syncRecordingsToProgram() creates with no
 * metadata). No new schema. Matched by zoomFileId or lessonId. The hub route
 * refuses to overwrite a lesson that already has content unless force:true —
 * this protects the lessons n8n already enriched from a careless re-run.
 */

import { z } from "zod";
import {
  HubError,
  type HubClient,
  type LessonContentUpdateItem,
} from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

function makeHttpsUrlSchema(fieldName: string) {
  return z.string().refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, `${fieldName} must be an absolute https:// URL.`);
}

const quizQuestionSchema = z
  .object({
    question: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(6),
    correct_answer: z.string().min(1),
    explanation: z.string().optional(),
  })
  .refine((value) => value.options.includes(value.correct_answer), {
    message: "correct_answer must be one of options.",
    path: ["correct_answer"],
  });

const quizQuestionsSchema = z.array(quizQuestionSchema).min(1).max(20);

const contentItemSchema = z.object({
  zoomFileId: z.string().optional(),
  lessonId: z.string().optional(),
  name: z.string().optional(),
  intro: z.string().optional(),
  text: z.string().optional(),
  tags: z.string().optional(),
  timecodes: z.string().optional(),
  posterUrl: makeHttpsUrlSchema("posterUrl").optional(),
  audioUrl: makeHttpsUrlSchema("audioUrl").optional(),
  captionsUrl: makeHttpsUrlSchema("captionsUrl").optional(),
  quizQuestions: quizQuestionsSchema.optional(),
  force: z.boolean().optional(),
});

export const lessonContentUpdateSchema = z.object({
  items: z.array(contentItemSchema).min(1).max(50),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type LessonContentUpdateInput = z.infer<typeof lessonContentUpdateSchema>;

function countTargets(item: z.infer<typeof contentItemSchema>): number {
  return [item.zoomFileId, item.lessonId].filter(
    (v) => typeof v === "string" && v.trim().length > 0
  ).length;
}

function renderValue(value: string): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length > 160) return `"${singleLine.slice(0, 120)}..." (${value.length} chars)`;
  return `"${singleLine}"`;
}

function renderPreview(
  items: LessonContentUpdateItem[],
  config: Config,
  previewId: string,
  expiresInMinutes: number
): string {
  const lines = [`PREVIEW · target: ${config.envLabel}`, `UPDATE content on ${items.length} lesson(s)`, ""];
  for (const item of items) {
    const target = item.lessonId ? `lessonId ${item.lessonId}` : `zoomFileId ${item.zoomFileId}`;
    lines.push(`— ${target}${item.force ? " (force)" : ""}`);
    if (item.name) lines.push(`  name: ${renderValue(item.name)}`);
    if (item.tags) lines.push(`  tags: ${renderValue(item.tags)}`);
    if (item.intro) lines.push(`  intro: ${renderValue(item.intro)}`);
    if (item.posterUrl) lines.push(`  posterUrl: ${renderValue(item.posterUrl)}`);
    if (item.audioUrl) lines.push(`  audioUrl: ${renderValue(item.audioUrl)}`);
    if (item.captionsUrl) lines.push(`  captionsUrl: ${renderValue(item.captionsUrl)}`);
    if (item.quizQuestions?.length) {
      const [firstQuestion] = item.quizQuestions;
      if (firstQuestion) {
        lines.push(
          `  quizQuestions: ${item.quizQuestions.length} question(s) · first: ${renderValue(firstQuestion.question)}`
        );
      }
    }
  }
  lines.push(
    "",
    "Nothing was committed. Items already carrying content are refused unless force:true.",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "To commit: call lesson_content_update again with previewId and confirm: true"
  );
  return lines.join("\n");
}

function renderCommit(results: Awaited<ReturnType<HubClient["updateLessonContent"]>>["items"], config: Config): string {
  const lines = [`COMMITTED · target: ${config.envLabel}`, ""];
  for (const r of results) {
    if (r.refused) {
      lines.push(`— ${r.lessonId || r.zoomFileId}: REFUSED — ${r.refused}`);
      continue;
    }
    const changedKeys = Object.keys(r.changed);
    lines.push(
      `— ${r.lessonId}: changed [${changedKeys.join(", ") || "none"}], unchanged [${r.unchanged.join(", ") || "none"}]`
    );
  }
  return lines.join("\n");
}

export function makeLessonContentUpdateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<LessonContentUpdateItem[]>
) {
  return async (input: LessonContentUpdateInput): Promise<string> => {
    const { items, dryRun, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run lesson_content_update with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const committed = await hub.updateLessonContent(taken.payload);
        return renderCommit(committed.items, config);
      } catch (error) {
        if (error instanceof HubError && error.status === 0) {
          previews.restore(previewId, taken.payload);
        }
        throw error;
      }
    }

    if (previewId && dryRun !== false) {
      return "Note: previewId was supplied without confirm: true, so nothing was committed. Re-send with confirm: true.";
    }

    for (const item of items) {
      if (countTargets(item) !== 1) {
        return "Refused: every item needs exactly one of zoomFileId or lessonId.";
      }
      if (
        !item.name &&
        !item.intro &&
        !item.text &&
        !item.tags &&
        !item.timecodes &&
        !item.posterUrl &&
        !item.audioUrl &&
        !item.captionsUrl &&
        !item.quizQuestions
      ) {
        return "Refused: every item needs at least one content field to write.";
      }
    }

    const payload: LessonContentUpdateItem[] = items;
    const { previewId: storedPreviewId, expiresInMinutes } = previews.put(payload);
    return renderPreview(payload, config, storedPreviewId, expiresInMinutes);
  };
}
