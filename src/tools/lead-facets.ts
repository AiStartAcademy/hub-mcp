import { z } from "zod";
import type { HubClient } from "../hub-client.js";

export const leadFacetsSchema = z.object({});

export type LeadFacetsInput = z.infer<typeof leadFacetsSchema>;

export function makeLeadFacetsHandler(hub: HubClient) {
  return async (_input: LeadFacetsInput): Promise<string> => {
    const facets = await hub.getLeadFacets();

    const statusLine = Object.entries(facets.pipelineStatuses)
      .map(([status, count]) => `${status} ${count}`)
      .join(" · ");

    const lines = [
      `pipeline leads: ${facets.pipelineContactCount} · excluded: ${facets.excludedFromPipelineCount} · all contacts: ${facets.allContactCount}`,
      `${facets.allContactUnsubscribedCount} unsubscribed across all contacts (never enrollable)`,
      `pipeline statuses: ${statusLine}`,
      "",
      "sources:",
      ...facets.pipelineSources.map((s) => `  ${s.source ?? "(none)"} — ${s.count}`),
      "",
      `tags (top ${facets.pipelineTags.length}${facets.pipelineTagScanCapped ? ", scan capped — counts approximate" : ""}):`,
      ...facets.pipelineTags.map((t) => `  ${t.tag} — ${t.count}`),
    ];

    if (facets.onboardingForms.length) {
      lines.push("", "onboarding quizzes (source = onboarding:<slug>):");
      for (const form of facets.onboardingForms) {
        lines.push(`  ${form.slug} — "${form.title}" · ${form.responses} responses`);
      }
    }

    lines.push(
      "",
      "Use these real values when authoring drip segments — tags and sources are free-form" +
        " strings, so a typo silently matches nobody."
    );
    return lines.join("\n");
  };
}
