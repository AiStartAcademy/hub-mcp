import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SERVER_NAME, SERVER_VERSION } from "../src/version.js";

describe("server identity", () => {
  test("uses the public server name", () => {
    expect(SERVER_NAME).toBe("hub-mcp");
  });

  test("keeps the server version aligned with package.json", () => {
    const parsed: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8")
    );
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      typeof parsed.version !== "string"
    ) {
      throw new Error("package.json must contain a string version");
    }

    expect(SERVER_VERSION).toBe(parsed.version);
  });
});
