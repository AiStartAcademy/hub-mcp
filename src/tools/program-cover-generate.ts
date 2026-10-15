/**
 * program_cover_generate — generates a course cover image via the hub's own
 * gpt-image-1.5 pipeline (same model/size/GCS destination as the admin UI's
 * "Generate Cover" button), so results are visually consistent with every
 * existing course cover. Costs real money per call — gated by
 * HUB_MCP_WRITES_ENABLED hub-side.
 *
 * ONE STEP, not preview/confirm: it doesn't write to the database (returns a
 * GCS URL only). Review the image before attaching it with program_update's
 * cover field.
 */

import { z } from "zod";
import type { HubClient } from "../hub-client.js";
import type { Config } from "../config.js";

export const programCoverGenerateSchema = z.object({
  prompt: z.string().min(1).max(4000),
});

export type ProgramCoverGenerateInput = z.infer<typeof programCoverGenerateSchema>;

export function makeProgramCoverGenerateHandler(hub: HubClient, config: Config) {
  return async (input: ProgramCoverGenerateInput): Promise<string> => {
    if (config.readOnly) {
      return "Refused: this MCP server is running with HUB_MCP_READONLY=true.";
    }
    const result = await hub.generateProgramCover(input.prompt);
    return [
      `GENERATED · target: ${config.envLabel}`,
      `url: ${result.url}`,
      "",
      "Not yet attached to any course. Review the image at this URL, then call",
      'program_update with { id, cover: "<this url>" } to set it.',
    ].join("\n");
  };
}
