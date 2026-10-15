import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";

const ENV_KEYS = [
  "HUB_BASE_URL",
  "HUB_MCP_TOKEN",
  "HUB_MCP_READONLY",
  "HUB_DEFAULT_TIMEZONE",
] as const;

let savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as typeof savedEnv;
  process.env.HUB_BASE_URL = "https://hub.example.com";
  process.env.HUB_MCP_TOKEN = "test-token";
  delete process.env.HUB_MCP_READONLY;
  delete process.env.HUB_DEFAULT_TIMEZONE;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("loadConfig", () => {
  test("requires HUB_BASE_URL and gives a generic example", () => {
    delete process.env.HUB_BASE_URL;
    expect(() => loadConfig()).toThrow("https://hub.example.com");
  });

  test("requires HUB_MCP_TOKEN", () => {
    delete process.env.HUB_MCP_TOKEN;
    expect(() => loadConfig()).toThrow("HUB_MCP_TOKEN");
  });

  test("strips a trailing slash", () => {
    process.env.HUB_BASE_URL = "https://hub.example.com/";
    expect(loadConfig().hubBaseUrl).toBe("https://hub.example.com");
  });

  test("only the exact string true enables read-only mode", () => {
    process.env.HUB_MCP_READONLY = "true";
    expect(loadConfig().readOnly).toBe(true);

    for (const value of ["TRUE", "false", "1", "yes", ""]) {
      process.env.HUB_MCP_READONLY = value;
      expect(loadConfig().readOnly).toBe(false);
    }
  });

  test("labels localhost and 127.0.0.1 as LOCAL", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1:3000"]) {
      process.env.HUB_BASE_URL = url;
      expect(loadConfig().envLabel).toBe("LOCAL");
    }
  });

  test("labels non-local origins as PROD", () => {
    expect(loadConfig().envLabel).toBe("PROD");
  });

  test("defaults HUB_DEFAULT_TIMEZONE to America/Los_Angeles", () => {
    expect(loadConfig().defaultTimezone).toBe("America/Los_Angeles");
  });

  test("treats an empty HUB_DEFAULT_TIMEZONE as unset", () => {
    process.env.HUB_DEFAULT_TIMEZONE = "";
    expect(loadConfig().defaultTimezone).toBe("America/Los_Angeles");
  });

  test("accepts a valid HUB_DEFAULT_TIMEZONE override", () => {
    process.env.HUB_DEFAULT_TIMEZONE = "Europe/Berlin";
    expect(loadConfig().defaultTimezone).toBe("Europe/Berlin");
  });

  test("rejects an invalid HUB_DEFAULT_TIMEZONE with a clear variable name", () => {
    process.env.HUB_DEFAULT_TIMEZONE = "Mars/Olympus_Mons";
    expect(() => loadConfig()).toThrow(/HUB_DEFAULT_TIMEZONE.*Mars\/Olympus_Mons/);
  });
});
