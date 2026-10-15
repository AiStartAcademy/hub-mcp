/**
 * Environment resolution, done once at startup so a misconfigured server fails
 * loudly on launch instead of on the first tool call.
 */

export interface Config {
  hubBaseUrl: string;
  hubToken: string;
  /** IANA timezone used by tools when the caller omits one. */
  defaultTimezone: string;
  /** Local kill switch. Note: bypassable by anyone holding the token — the
   *  authoritative switch is HUB_MCP_WRITES_ENABLED on the hub itself. */
  readOnly: boolean;
  /** Shown in every tool response so the operator always knows what they're pointed at. */
  envLabel: string;
}

export function loadConfig(): Config {
  const hubBaseUrl = process.env.HUB_BASE_URL?.replace(/\/$/, "");
  const hubToken = process.env.HUB_MCP_TOKEN;
  const defaultTimezone = process.env.HUB_DEFAULT_TIMEZONE || "America/Los_Angeles";

  if (!hubBaseUrl) throw new Error("HUB_BASE_URL is not set (e.g. https://hub.example.com)");
  if (!hubToken) throw new Error("HUB_MCP_TOKEN is not set — it must match the hub's value");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: defaultTimezone });
  } catch {
    throw new Error(
      `HUB_DEFAULT_TIMEZONE is invalid: ${defaultTimezone}. Set it to a valid IANA timezone.`
    );
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(hubBaseUrl);
  return {
    hubBaseUrl,
    hubToken,
    defaultTimezone,
    readOnly: process.env.HUB_MCP_READONLY === "true",
    envLabel: isLocal ? "LOCAL" : "PROD",
  };
}
