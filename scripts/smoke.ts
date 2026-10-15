/**
 * End-to-end smoke test: launches the server over real stdio and drives it with
 * raw JSON-RPC, exactly as an MCP client would. No mocks.
 *
 *   HUB_BASE_URL=http://localhost:3000 HUB_MCP_TOKEN=... bun run scripts/smoke.ts
 */

import { spawn } from "node:child_process";

interface ToolInfo {
  name: string;
  inputSchema: { required?: unknown };
}

interface JsonRpcResponse {
  id?: number;
  result?: {
    serverInfo?: { name: string; version: string };
    tools?: ToolInfo[];
    content?: Array<{ text?: string }>;
  };
  error?: unknown;
}

interface InstructorListResponse {
  items?: Array<{ id?: string }>;
}

interface InstructorDetailResponse {
  item: {
    bio?: string | null;
    linkedinUrl?: string | null;
  };
}

const proc = spawn("bun", ["run", "src/index.ts"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: process.env,
});

proc.stderr.on("data", (d) => process.stderr.write(`  [server] ${d}`));

let buffer = "";
const pending = new Map<number, (msg: JsonRpcResponse) => void>();

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let nl: number;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const parsed: unknown = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) {
      throw new Error(`invalid JSON-RPC response: ${line}`);
    }
    const msg = parsed as JsonRpcResponse;
    if (typeof msg.id !== "number") {
      throw new Error(`JSON-RPC response has no numeric id: ${line}`);
    }
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});

let nextId = 1;
function rpc(method: string, params?: unknown): Promise<JsonRpcResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout on ${method}`)), 15000);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
}

function notify(method: string, params?: unknown) {
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
}

function text(response: JsonRpcResponse): string {
  return (
    response.result?.content?.[0]?.text ??
    JSON.stringify(response.error ?? response.result) ??
    ""
  );
}

function assertStep(step: string, condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`${step} failed: ${message}`);
  }
}

function requireEnv(name: "HUB_BASE_URL" | "HUB_MCP_TOKEN"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`missing required env var ${name}`);
  }
  return value;
}

function previewIdFrom(step: string, output: string): string {
  const previewId = output.match(/previewId: (pv_\w+)/)?.[1];
  assertStep(step, previewId, `no previewId in output:\n${output}`);
  return previewId;
}

async function hubGetJson<Response>(path: string): Promise<Response> {
  const response = await fetch(new URL(path, requireEnv("HUB_BASE_URL")), {
    headers: {
      Authorization: `Bearer ${requireEnv("HUB_MCP_TOKEN")}`,
    },
  });
  const bodyText = await response.text();
  const body: unknown = bodyText ? JSON.parse(bodyText) : null;
  if (!response.ok) {
    throw new Error(`hub GET ${path} failed (${response.status}): ${bodyText}`);
  }
  return body as Response;
}

try {
  const init = await rpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0" },
  });
  const serverInfo = init.result?.serverInfo;
  assertStep("initialize", serverInfo, "response did not include serverInfo");
  console.log(`✓ initialize → ${serverInfo.name} v${serverInfo.version}`);
  notify("notifications/initialized");

  const tools = await rpc("tools/list");
  const listedTools = tools.result?.tools;
  assertStep("tools/list", listedTools, "response did not include tools");
  const names = listedTools.map((tool) => tool.name);
  console.log(`✓ tools/list → [${names.join(", ")}]`);
  const schema = listedTools[0]?.inputSchema;
  assertStep("tools/list", schema, "response included no tool schemas");
  console.log(`  required args: ${JSON.stringify(schema.required)}`);

  console.log("\n─── beat 1: dry run (default) ───");
  const preview = await rpc("tools/call", {
    name: "cohort_create",
    arguments: {
      title: "MCP Smoke Test Cohort",
      startDate: "2026-09-07",
      endDate: "2026-09-11",
      deliveryMode: "HYBRID",
      location: "123 Main St, Springfield",
      groups: [{ name: "Online Group", price: 350, seats: 40 }],
    },
  });
  const previewText = text(preview);
  console.log(previewText);
  const previewId = previewIdFrom("cohort dry run", previewText);

  console.log("\n─── negative: confirm with a bogus previewId ───");
  console.log(
    text(
      await rpc("tools/call", {
        name: "cohort_create",
        arguments: { title: "x", previewId: "pv_nonsense", confirm: true },
      })
    )
  );

  console.log("\n─── beat 2: confirm ───");
  console.log(
    text(
      await rpc("tools/call", {
        name: "cohort_create",
        arguments: { title: "MCP Smoke Test Cohort", previewId, confirm: true },
      })
    )
  );

  console.log("\n─── negative: reusing a spent previewId ───");
  console.log(
    text(
      await rpc("tools/call", {
        name: "cohort_create",
        arguments: { title: "MCP Smoke Test Cohort", previewId, confirm: true },
      })
    )
  );

  console.log("\n!!! INSTRUCTOR SECTION MUTATES A REAL USER ROW. HUB_BASE_URL MUST POINT AT A LOCAL HUB. !!!");
  console.log("\n─── instructor step 1: tools/list includes instructor tools ───");
  assertStep("instructor step 1", names.includes("instructor_list"), "tools/list missing instructor_list");
  assertStep("instructor step 1", names.includes("instructor_get"), "tools/list missing instructor_get");
  assertStep(
    "instructor step 1",
    names.includes("instructor_profile_update"),
    "tools/list missing instructor_profile_update"
  );
  console.log("✓ found instructor_list, instructor_get, instructor_profile_update");

  console.log("\n─── instructor step 2: instructor_list rows ───");
  const instructorListCall = await rpc("tools/call", {
    name: "instructor_list",
    arguments: { pageSize: 10 },
  });
  const instructorListText = text(instructorListCall);
  console.log(instructorListText);

  const instructorListJson = await hubGetJson<InstructorListResponse>(
    "/api/internal/mcp/v1/instructors?pageSize=1"
  );
  const firstInstructor = instructorListJson.items?.[0];

  if (!firstInstructor) {
    console.log("no instructors in this hub — remaining instructor steps skipped");
  } else {
    const instructorId = firstInstructor.id;
    assertStep("instructor step 3", instructorId, "could not capture first instructor id");
    console.log(`\n─── instructor step 3: picked target ${instructorId} ───`);

    console.log("\n─── instructor step 4: instructor_get current values ───");
    const instructorBefore = await rpc("tools/call", {
      name: "instructor_get",
      arguments: { id: instructorId },
    });
    const instructorBeforeText = text(instructorBefore);
    console.log(instructorBeforeText);
    const detailBefore = await hubGetJson<InstructorDetailResponse>(
      `/api/internal/mcp/v1/instructors?id=${encodeURIComponent(instructorId)}`
    );
    console.log("!! RECORD THESE — the confirm step below overwrites them");
    console.log(`bio: ${detailBefore.item.bio ?? "null"}`);
    console.log(`linkedinUrl: ${detailBefore.item.linkedinUrl ?? "null"}`);

    const smokeBio = `MCP smoke test bio ${new Date().toISOString()}`;
    const smokeLinkedinUrl = `https://www.linkedin.com/in/mcp-smoke-${Date.now()}/`;

    console.log("\n─── instructor step 5: dry run ───");
    const instructorPreview = await rpc("tools/call", {
      name: "instructor_profile_update",
      arguments: {
        userId: instructorId,
        bio: smokeBio,
        linkedinUrl: smokeLinkedinUrl,
      },
    });
    const instructorPreviewText = text(instructorPreview);
    console.log(instructorPreviewText);
    const instructorPreviewId = previewIdFrom("instructor step 5", instructorPreviewText);

    console.log("\n─── instructor step 6: forbidden-key refusal ───");
    const forbiddenKey = await rpc("tools/call", {
      name: "instructor_profile_update",
      arguments: {
        userId: instructorId,
        bio: smokeBio,
        linkedinUrl: smokeLinkedinUrl,
        role: "ADMIN",
      },
    });
    const forbiddenKeyText = text(forbiddenKey);
    console.log(forbiddenKeyText);
    assertStep(
      "instructor step 6",
      /refused/i.test(forbiddenKeyText) && forbiddenKeyText.includes("role"),
      `expected refusal naming role, got:\n${forbiddenKeyText}`
    );

    console.log("\n─── instructor step 7: bogus previewId refusal ───");
    const bogusPreview = await rpc("tools/call", {
      name: "instructor_profile_update",
      arguments: {
        userId: instructorId,
        previewId: "pv_nonsense",
        confirm: true,
      },
    });
    const bogusPreviewText = text(bogusPreview);
    console.log(bogusPreviewText);
    assertStep(
      "instructor step 7",
      /refused/i.test(bogusPreviewText) && bogusPreviewText.includes("pv_nonsense"),
      `expected bogus previewId refusal, got:\n${bogusPreviewText}`
    );

    console.log("\n─── instructor step 8: confirm ───");
    const confirmInstructor = await rpc("tools/call", {
      name: "instructor_profile_update",
      arguments: {
        userId: instructorId,
        previewId: instructorPreviewId,
        confirm: true,
      },
    });
    const confirmInstructorText = text(confirmInstructor);
    console.log(confirmInstructorText);
    assertStep(
      "instructor step 8",
      confirmInstructorText.includes("COMMITTED") &&
        confirmInstructorText.includes(smokeBio) &&
        confirmInstructorText.includes(smokeLinkedinUrl),
      `expected committed diff with bio and linkedinUrl, got:\n${confirmInstructorText}`
    );

    console.log("\n─── instructor step 9: re-read shows new bio and linkedinUrl ───");
    const instructorAfter = await rpc("tools/call", {
      name: "instructor_get",
      arguments: { id: instructorId },
    });
    const instructorAfterText = text(instructorAfter);
    console.log(instructorAfterText);
    assertStep(
      "instructor step 9",
      instructorAfterText.includes(`bio: ${smokeBio}`) &&
        instructorAfterText.includes(`linkedinUrl: ${smokeLinkedinUrl}`),
      `re-read did not show the new bio/linkedinUrl:\n${instructorAfterText}`
    );

    console.log("\n─── instructor step 10: spent previewId replay refusal ───");
    const spentPreview = await rpc("tools/call", {
      name: "instructor_profile_update",
      arguments: {
        userId: instructorId,
        previewId: instructorPreviewId,
        confirm: true,
      },
    });
    const spentPreviewText = text(spentPreview);
    console.log(spentPreviewText);
    assertStep(
      "instructor step 10",
      /refused/i.test(spentPreviewText) && spentPreviewText.includes(instructorPreviewId),
      `expected spent previewId refusal, got:\n${spentPreviewText}`
    );
  }
} finally {
  proc.kill();
}
