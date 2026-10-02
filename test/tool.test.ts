import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { validateEventPayload } from "../src/gather/events.ts";
import { GatherCoordinator } from "../src/runtime/coordinator.ts";
import { createGatherSendTool } from "../src/tool.ts";

const SYNTHETIC_SECRET = "whsec_dGVzdF9zZWNyZXRfMTIzNDU2Nzg5MDEyMzQ1Njc4OTA=";

function createTestCoordinator(configObj: Record<string, unknown>, envContent: string) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gather-tool-test-"));
  const configFile = path.join(tmpDir, "pi-gather-hooks.json");
  const envFile = path.join(tmpDir, "gather.env");

  fs.writeFileSync(envFile, envContent, { mode: 0o600 });
  const fullConfig = {
    credentialsFile: envFile,
    ...configObj,
  };
  fs.writeFileSync(configFile, JSON.stringify(fullConfig, null, 2));

  const coordinator = new GatherCoordinator(configFile);
  return { coordinator, tmpDir };
}

describe("Event payload validation", () => {
  it("validates info.set constraints", () => {
    expect(() => validateEventPayload("info.set", {})).toThrow("requires at least one");
    expect(() => validateEventPayload("info.set", { name: "x".repeat(121) })).toThrow(
      "<= 120 characters",
    );
    expect(() => validateEventPayload("info.set", { description: "x".repeat(2001) })).toThrow(
      "<= 2000 characters",
    );

    const valid = validateEventPayload("info.set", {
      name: "Chunky",
      description: "Helper",
    });
    expect(valid.name).toBe("Chunky");
    expect(valid.description).toBe("Helper");
  });

  it("validates status.set states", () => {
    expect(() => validateEventPayload("status.set", {})).toThrow("requires 'state'");
    expect(() => validateEventPayload("status.set", { state: "invalid" })).toThrow(
      "one of: off, on, question, alert, working",
    );

    const valid = validateEventPayload("status.set", { state: "working" });
    expect(valid.state).toBe("working");
  });

  it("validates activity.add constraints and url", () => {
    expect(() => validateEventPayload("activity.add", { text: "msg" })).toThrow(
      "requires a non-empty string 'id'",
    );
    expect(() => validateEventPayload("activity.add", { id: "1", text: "" })).toThrow(
      "requires a non-empty string 'text'",
    );
    expect(() =>
      validateEventPayload("activity.add", {
        id: "1",
        text: "msg",
        url: "ftp://invalid.com",
      }),
    ).toThrow("must use http or https");

    const valid = validateEventPayload("activity.add", {
      id: "pr-1",
      text: "Testing PR",
      url: "https://github.com/pr/1",
    });
    expect(valid.id).toBe("pr-1");
    expect(valid.text).toBe("Testing PR");
    expect(valid.url).toBe("https://github.com/pr/1");
  });

  it("validates counter operations", () => {
    expect(() => validateEventPayload("counter.set", {})).toThrow("requires integer 'count'");
    expect(() => validateEventPayload("counter.set", { count: -1 })).toThrow(
      "requires integer 'count' >= 0",
    );

    const setRes = validateEventPayload("counter.set", { count: 5 });
    expect(setRes.count).toBe(5);

    expect(() => validateEventPayload("counter.increment", { by: 0 })).toThrow(
      "requires integer 'by' >= 1",
    );
    const incRes = validateEventPayload("counter.increment", { by: 2 });
    expect(incRes.by).toBe(2);
  });
});

describe("gather_send Tool Execution", () => {
  it("rejects execution when config is disabled", async () => {
    const { coordinator, tmpDir } = createTestCoordinator({ version: 1, enabled: false }, "");

    try {
      const tool = createGatherSendTool(coordinator);
      const res = await tool.execute(
        "call-1",
        { event: "webhook.ping" },
        undefined,
        undefined,
        {} as never,
      );

      expect(res.isError).toBe(true);
      const textItem = res.content[0];
      const text = textItem && "text" in textItem ? textItem.text : "";
      expect(text).toContain("disabled in configuration");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles webhook.ping and formats clean output", async () => {
    const { coordinator, tmpDir } = createTestCoordinator(
      {
        version: 1,
        enabled: true,
        defaultObject: "testObj",
        objects: {
          testObj: { urlEnv: "GSO_TEST_URL", secretEnv: "GSO_TEST_SECRET" },
        },
      },
      `GSO_TEST_URL="http://localhost:8989/test"\nGSO_TEST_SECRET="${SYNTHETIC_SECRET}"\n`,
    );

    try {
      // Mock the client ping
      const client = coordinator.getClient("testObj");
      client.ping = async () => ({
        status: "pong",
        objectId: "obj-uuid",
        spaceId: "space-uuid",
        preset: "status",
        capabilities: {
          status: { state: "on" },
          variant: { color: "green" },
          activity: {
            entries: [{ id: "act-1", text: "Working on task" }],
          },
        },
        colors: ["green", "red", "blue"],
      });

      const tool = createGatherSendTool(coordinator);
      const res = await tool.execute(
        "call-2",
        { event: "webhook.ping" },
        undefined,
        undefined,
        {} as never,
      );

      expect(res.isError).toBeFalsy();
      const textItem = res.content[0];
      const text = textItem && "text" in textItem ? textItem.text : "";
      expect(text).toContain("Gather object 'testObj' (preset: status):");
      expect(text).toContain("Space ID: space-uuid");
      expect(text).toContain("Available colors: green, red, blue");
      expect(text).toContain("Current status: on");
      expect(text).toContain("[act-1] Working on task");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("sets manual override on status.set and variant.set", async () => {
    const { coordinator, tmpDir } = createTestCoordinator(
      {
        version: 1,
        enabled: true,
        defaultObject: "testObj",
        objects: {
          testObj: { urlEnv: "GSO_TEST_URL", secretEnv: "GSO_TEST_SECRET" },
        },
      },
      `GSO_TEST_URL="http://localhost:8989/test"\nGSO_TEST_SECRET="${SYNTHETIC_SECRET}"\n`,
    );

    try {
      const client = coordinator.getClient("testObj");
      client.send = async () => ({ status: "dispatched" });
      client.ping = async () => ({
        status: "pong",
        objectId: "id",
        spaceId: "sp",
        preset: "status",
        capabilities: {},
        colors: ["green", "red", "blue"],
      });

      const tool = createGatherSendTool(coordinator);

      // Execute status.set
      await tool.execute(
        "call-3",
        { event: "status.set", data: { state: "alert" } },
        undefined,
        undefined,
        {} as never,
      );

      const override = coordinator.getManualOverride("testObj");
      expect(override?.status).toBe("alert");

      // Execute variant.set with valid color
      await tool.execute(
        "call-4",
        { event: "variant.set", data: { color: "red" } },
        undefined,
        undefined,
        {} as never,
      );

      const updatedOverride = coordinator.getManualOverride("testObj");
      expect(updatedOverride?.color).toBe("red");

      // Execute variant.set with invalid color
      const invalidColorRes = await tool.execute(
        "call-5",
        { event: "variant.set", data: { color: "purple" } },
        undefined,
        undefined,
        {} as never,
      );
      expect(invalidColorRes.isError).toBe(true);
      const invTextItem = invalidColorRes.content[0];
      const invText = invTextItem && "text" in invTextItem ? invTextItem.text : "";
      expect(invText).toContain("not in the object's supported colors");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
