/**
 * media_upload — uploads a local file into the hub's media library (GCS +
 * Media row), the same destination as the admin UI's /api/upload. Takes a
 * filesystem path, base64-encodes it, and POSTs to the hub's MCP media
 * endpoint. Gated by HUB_MCP_WRITES_ENABLED hub-side.
 *
 * `public: true` stores the object under a `previews/` key, which the hub's
 * /api/media route serves WITHOUT authentication — use it for images that
 * marketing/landing pages show to guests. Leave it off for member-only files.
 */

import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";
import type { HubClient } from "../hub-client.js";
import type { Config } from "../config.js";

// Mirrors MAX_BYTES in the hub's /api/internal/mcp/v1/media/upload route.
// Keep this in sync; if the hub raises its limit, raise this too.
export const HUB_MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  // Images/documents
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  // Text & captions
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".vtt": "text/vtt",
  ".srt": "application/x-subrip",
  ".json": "application/json",
  // Audio
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
};

export const mediaUploadSchema = z.object({
  filePath: z
    .string()
    .min(1)
    .describe("Absolute path of the local file to upload"),
  name: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe("Filename to store under (defaults to the local basename)"),
  namespace: z
    .string()
    .max(100)
    .optional()
    .describe('Media namespace folder, e.g. "marketing" (default "general")'),
  slug: z
    .string()
    .max(100)
    .optional()
    .describe('Sub-folder, e.g. "membership" (default: current YYYY-MM)'),
  public: z
    .boolean()
    .optional()
    .describe(
      "Store under a publicly-served previews/ key (guest-visible pages). Default false = auth-only."
    ),
});

export type MediaUploadInput = z.infer<typeof mediaUploadSchema>;

export function makeMediaUploadHandler(hub: HubClient, config: Config) {
  return async (input: MediaUploadInput): Promise<string> => {
    if (config.readOnly) {
      return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
    }

    const filename = input.name?.trim() || basename(input.filePath);
    const mimeType = MIME_BY_EXT[extname(filename).toLowerCase()];
    if (!mimeType) {
      return `Refused: unsupported file extension on "${filename}" — supported: ${Object.keys(MIME_BY_EXT).join(", ")}`;
    }

    const fileStats = await stat(input.filePath);
    if (fileStats.size > HUB_MAX_UPLOAD_BYTES) {
      return `Refused: file size ${fileStats.size} bytes exceeds the hub-side upload limit of ${HUB_MAX_UPLOAD_BYTES} bytes for "${input.filePath}".`;
    }

    const buffer = await readFile(input.filePath);
    const result = await hub.uploadMedia({
      filename,
      mimeType,
      dataBase64: buffer.toString("base64"),
      namespace: input.namespace,
      slug: input.slug,
      public: input.public === true,
    });

    return [
      `UPLOADED · target: ${config.envLabel}`,
      `url: ${result.url}`,
      `objectKey: ${result.objectKey}`,
      `size: ${result.size} bytes · public: ${result.public}`,
      "",
      result.public
        ? "This URL is served without authentication — safe to reference from guest-facing pages."
        : "This URL requires a signed-in hub session to load.",
    ].join("\n");
  };
}
