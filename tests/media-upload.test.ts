import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../src/config.js";
import type { HubClient, MediaUploadPayload, MediaUploadResponse } from "../src/hub-client.js";
import {
  HUB_MAX_UPLOAD_BYTES,
  makeMediaUploadHandler,
} from "../src/tools/media-upload.js";

const config: Config = {
  hubBaseUrl: "http://localhost:3000",
  hubToken: "test",
  readOnly: false,
  envLabel: "LOCAL",
  defaultTimezone: "America/Los_Angeles",
};

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function makeTempFile(name: string, contents: string | Uint8Array): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "hub-mcp-media-upload-"));
  tempDirs.push(dir);

  const filePath = join(dir, name);
  await writeFile(filePath, contents);
  return filePath;
}

describe("media_upload handler", () => {
  test("uploads a text caption file with text/vtt", async () => {
    const calls: MediaUploadPayload[] = [];
    const hub = {
      uploadMedia: async (payload: MediaUploadPayload): Promise<MediaUploadResponse> => {
        calls.push(payload);
        return {
          url: "https://cdn.example.com/captions.vtt",
          objectKey: "media/captions.vtt",
          size: 29,
          public: false,
        };
      },
    } as unknown as HubClient;
    const handler = makeMediaUploadHandler(hub, config);
    const filePath = await makeTempFile("captions.vtt", "WEBVTT\n\n00:00.000 --> 00:01.000");

    const result = await handler({ filePath });

    expect(result).toContain("UPLOADED · target: LOCAL");
    expect(calls).toEqual([
      {
        filename: "captions.vtt",
        mimeType: "text/vtt",
        dataBase64: Buffer.from("WEBVTT\n\n00:00.000 --> 00:01.000").toString("base64"),
        namespace: undefined,
        slug: undefined,
        public: false,
      },
    ]);
  });

  test("uploads an audio file with audio/mpeg", async () => {
    const calls: MediaUploadPayload[] = [];
    const hub = {
      uploadMedia: async (payload: MediaUploadPayload): Promise<MediaUploadResponse> => {
        calls.push(payload);
        return {
          url: "https://cdn.example.com/lesson.mp3",
          objectKey: "media/lesson.mp3",
          size: 4,
          public: true,
        };
      },
    } as unknown as HubClient;
    const handler = makeMediaUploadHandler(hub, config);
    const bytes = new Uint8Array([0, 1, 2, 3]);
    const filePath = await makeTempFile("lesson.mp3", bytes);

    const result = await handler({ filePath, public: true });

    expect(result).toContain("UPLOADED · target: LOCAL");
    expect(calls).toEqual([
      {
        filename: "lesson.mp3",
        mimeType: "audio/mpeg",
        dataBase64: Buffer.from(bytes).toString("base64"),
        namespace: undefined,
        slug: undefined,
        public: true,
      },
    ]);
  });

  test("still refuses an unsupported extension", async () => {
    let uploadCalls = 0;
    const hub = {
      uploadMedia: async (): Promise<MediaUploadResponse> => {
        uploadCalls += 1;
        return {
          url: "https://cdn.example.com/ignored.bin",
          objectKey: "media/ignored.bin",
          size: 0,
          public: false,
        };
      },
    } as unknown as HubClient;
    const handler = makeMediaUploadHandler(hub, config);
    const filePath = await makeTempFile("unsupported.bin", "payload");

    const result = await handler({ filePath });

    expect(result).toBe(
      'Refused: unsupported file extension on "unsupported.bin" — supported: .jpg, .jpeg, .png, .webp, .gif, .svg, .pdf, .txt, .md, .vtt, .srt, .json, .mp3, .m4a, .wav, .aac, .ogg'
    );
    expect(uploadCalls).toBe(0);
  });

  test("refuses a file larger than the hub-side limit without reading it", async () => {
    let uploadCalls = 0;
    const hub = {
      uploadMedia: async (): Promise<MediaUploadResponse> => {
        uploadCalls += 1;
        return {
          url: "https://cdn.example.com/too-large.mp3",
          objectKey: "media/too-large.mp3",
          size: HUB_MAX_UPLOAD_BYTES + 1,
          public: false,
        };
      },
    } as unknown as HubClient;
    const handler = makeMediaUploadHandler(hub, config);
    const filePath = await makeTempFile("too-large.mp3", "");
    await truncate(filePath, HUB_MAX_UPLOAD_BYTES + 1);
    await chmod(filePath, 0o000);

    const result = await handler({ filePath });

    expect(result).toBe(
      `Refused: file size ${HUB_MAX_UPLOAD_BYTES + 1} bytes exceeds the hub-side upload limit of ${HUB_MAX_UPLOAD_BYTES} bytes for "${filePath}".`
    );
    expect(uploadCalls).toBe(0);
  });
});
