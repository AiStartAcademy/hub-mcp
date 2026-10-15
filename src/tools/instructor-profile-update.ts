/**
 * instructor_profile_update — preview first, then commit the stored payload.
 *
 * Like cohort_create, the only write path is confirm: true with a previewId
 * from a prior dry run.
 */

import { z } from "zod";
import {
  HubError,
  type HubClient,
  type InstructorDetailItem,
  type InstructorProfileField,
} from "../hub-client.js";
import type { Config } from "../config.js";
import type { PreviewStore } from "../preview-store.js";

const PROFILE_FIELDS = [
  "headline",
  "bio",
  "location",
  "languages",
  "expertiseTags",
  "linkedinUrl",
  "image",
  "timezone",
  "profileVisibility",
  "publicSlug",
] as const satisfies readonly InstructorProfileField[];

const previewableString = z.union([z.string(), z.null()]);

export const instructorProfileUpdateSchema = z.object({
  userId: z.string().optional(),
  email: z.string().optional(),
  slug: z.string().optional(),
  headline: previewableString.optional(),
  bio: previewableString.optional(),
  location: previewableString.optional(),
  languages: previewableString.optional(),
  expertiseTags: previewableString.optional(),
  linkedinUrl: previewableString.optional(),
  image: previewableString.optional(),
  timezone: z.string().optional(),
  profileVisibility: z.enum(["PRIVATE", "PUBLIC", "UNLISTED"]).optional(),
  publicSlug: z.string().optional(),
  dryRun: z.boolean().optional().default(true),
  previewId: z.string().optional(),
  confirm: z.boolean().optional(),
});

export type InstructorProfileUpdateInput = z.infer<typeof instructorProfileUpdateSchema>;

export type InstructorProfileUpdatePayload = {
  userId: string;
} & Partial<Record<(typeof PROFILE_FIELDS)[number], string | null>>;

function countTargets(input: Pick<InstructorProfileUpdateInput, "userId" | "email" | "slug">): number {
  return [input.userId, input.email, input.slug].filter(
    (value) => typeof value === "string" && value.trim().length > 0
  ).length;
}

function hasOwn<K extends string>(value: object, key: K): value is Record<K, unknown> {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeTargetValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function renderValue(value: string | null): string {
  if (value === null) return "null";
  if (value === "") return "\"\"";

  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length > 240) {
    return `"${singleLine.slice(0, 160)}..." (${value.length} chars)`;
  }
  return `"${singleLine}"`;
}

/**
 * The stored current value for a writable field. `publicSlug` is the API's name for
 * the hub's `slug` column, so it needs an explicit hop; everything else matches.
 *
 * KNOWN LIMITATION (pre-existing, not introduced with the timezone/visibility fields):
 * `linkedinUrl` here is the detail endpoint's *normalized* view — it round-trips through
 * `new URL().toString()` and becomes null for any stored value failing the https//in/
 * checks — while the PATCH route compares against the raw stored string. So for
 * linkedinUrl only, the preview's "current" can differ from what the row holds, and an
 * effective no-op can report as changed. Fixing it properly means deciding what a write
 * should do when the stored value is invalid (normalize? clear? preserve?), which is a
 * separate call from this change.
 */
function currentValueOf(
  item: InstructorDetailItem,
  field: (typeof PROFILE_FIELDS)[number]
): string | null {
  if (field === "publicSlug") return item.slug;
  return item[field] ?? null;
}

/**
 * Loud, unmissable banners for the two changes a human must not confirm by reflex.
 *
 * Until now this tool could not publish anything — profileVisibility was unwritable,
 * so PRIVATE was a structural guarantee. It is now a value the model can propose, and
 * the human reading the diff is the only thing standing between a draft and a live page.
 *
 * Deliberately does NOT claim a URL goes live: the hub has no
 * /humans/{slug} route (it 404s) and nothing reads profileVisibility, so promising
 * "world-readable at /humans/x" would be a false warning — worse than none, because it
 * trains the reader to discount the banner. Say what is actually true instead.
 */
function warnings(
  payload: InstructorProfileUpdatePayload,
  item: InstructorDetailItem
): string[] {
  const lines: string[] = [];

  const nextVisibility = payload.profileVisibility;
  if (nextVisibility && nextVisibility !== item.profileVisibility) {
    if (nextVisibility === "PRIVATE") {
      lines.push(`⚠ VISIBILITY: ${item.profileVisibility} → PRIVATE.`);
    } else {
      lines.push(
        `⚠ VISIBILITY: ${item.profileVisibility} → ${nextVisibility}. This marks the profile as`,
        "⚠ publishable. Confirm only if you have read the bio above and intend it to be seen.",
        "⚠ (No public page serves this flag yet — it grants intent, not exposure, today.)"
      );
    }
  }

  // Renaming a handle that already exists breaks whatever links to the old one; there is
  // no redirect and no old-slug retention, so the human has to make that call knowingly.
  if (payload.publicSlug && item.slug && payload.publicSlug !== item.slug) {
    lines.push(
      `⚠ HANDLE: "${item.slug}" → "${payload.publicSlug}". The old handle stops resolving;`,
      "⚠ nothing redirects it. Any link already pointing at it will break."
    );
  }
  if (payload.publicSlug === null && item.slug) {
    lines.push(`⚠ HANDLE: "${item.slug}" is being cleared — the profile will have no handle.`);
  }

  return lines;
}

function renderPreview(
  payload: InstructorProfileUpdatePayload,
  item: InstructorDetailItem,
  config: Config,
  diffLines: string[],
  previewId: string,
  expiresInMinutes: number
): string {
  const warning = warnings(payload, item);
  return [
    `PREVIEW · target: ${config.envLabel}`,
    `UPDATE instructor profile for ${item.name ?? payload.userId}`,
    `userId: ${payload.userId}`,
    "",
    ...diffLines,
    ...(warning.length ? ["", ...warning] : []),
    "",
    `previewId: ${previewId} · expires in ${expiresInMinutes} minutes`,
    "Nothing was committed.",
    "To commit: call instructor_profile_update again with previewId and confirm: true",
  ].join("\n");
}

function renderCommit(
  userId: string,
  changed: Partial<Record<InstructorProfileField, { from: string | null; to: string | null }>>,
  unchanged: InstructorProfileField[],
  config: Config
): string {
  const changedLines = Object.entries(changed).map(
    ([field, diff]) => `${field}: ${renderValue(diff.from)} → ${renderValue(diff.to)}`
  );

  const lines = [
    `COMMITTED · target: ${config.envLabel}`,
    `userId: ${userId}`,
    ...(changedLines.length ? changedLines : ["changed: none"]),
    `unchanged: ${unchanged.length ? unchanged.join(", ") : "none"}`,
  ];

  return lines.join("\n");
}

export function makeInstructorProfileUpdateHandler(
  hub: HubClient,
  config: Config,
  previews: PreviewStore<InstructorProfileUpdatePayload>
) {
  return async (input: InstructorProfileUpdateInput): Promise<string> => {
    const { userId, email, slug, dryRun, previewId, confirm } = input;

    if (confirm === true) {
      if (!previewId) {
        return "Refused: confirm requires the previewId from a dry run. Run instructor_profile_update with dryRun first.";
      }
      if (config.readOnly) {
        return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
      }
      const taken = previews.take(previewId);
      if (!taken.ok) return `Refused: ${taken.reason}`;

      try {
        const committed = await hub.updateInstructorProfile(taken.payload);
        return renderCommit(committed.userId, committed.changed, committed.unchanged, config);
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

    if (countTargets({ userId, email, slug }) !== 1) {
      return "Refused: provide exactly one of userId, email, or slug.";
    }

    if (email) {
      return "Refused: dry runs currently require userId or slug because the hub instructor detail endpoint does not support email lookup.";
    }

    const payload: InstructorProfileUpdatePayload = {
      userId: normalizeTargetValue(userId) ?? "",
    };
    const requestedFields: InstructorProfileField[] = [];

    for (const field of PROFILE_FIELDS) {
      if (!hasOwn(input, field)) continue;
      payload[field] = input[field];
      requestedFields.push(field);
    }

    if (!requestedFields.length) {
      return "Refused: provide at least one profile field to update.";
    }

    const targetUserId = normalizeTargetValue(userId);
    const targetSlug = normalizeTargetValue(slug);
    const detail = await hub.getInstructor(targetUserId ? { id: targetUserId } : { slug: targetSlug });
    payload.userId = detail.item.id;

    const diffLines = requestedFields.map((field) => {
      const currentValue = currentValueOf(detail.item, field);
      const nextValue = payload[field] ?? null;
      return `${field}: ${renderValue(currentValue)} → ${renderValue(nextValue)}`;
    });

    const { previewId: storedPreviewId, expiresInMinutes } = previews.put(payload);
    return renderPreview(
      payload,
      detail.item,
      config,
      diffLines,
      storedPreviewId,
      expiresInMinutes
    );
  };
}
