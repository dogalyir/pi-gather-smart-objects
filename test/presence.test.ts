import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { GatherCoordinator } from "../src/runtime/coordinator.ts";
import { PresenceManager, PresenceStateMachine } from "../src/runtime/presence.ts";

const SYNTHETIC_SECRET = "whsec_dGVzdF9zZWNyZXRfMTIzNDU2Nzg5MDEyMzQ1Njc4OTA=";

function createPresenceTestSetup(configOverrides: Record<string, unknown> = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gather-presence-test-"));
  const configFile = path.join(tmpDir, "pi-gather-hooks.json");
  const envFile = path.join(tmpDir, "gather.env");

  fs.writeFileSync(
    envFile,
    `GSO_PI_URL="http://localhost:9999/pi"\nGSO_PI_SECRET="${SYNTHETIC_SECRET}"\n`,
    { mode: 0o600 },
  );

  const fullConfig = {
    version: 1,
    enabled: true,
    defaultObject: "pi",
    credentialsFile: envFile,
    objects: {
      pi: { urlEnv: "GSO_PI_URL", secretEnv: "GSO_PI_SECRET" },
    },
    hooks: {
      enabled: true,
      object: "pi",
      modes: ["tui"],
      states: {
        ready: { state: "on", color: "green" },
        working: { state: "working", color: "blue" },
        waiting: { state: "question", color: "yellow" },
        error: { state: "alert", color: "red" },
        stopped: { state: "off", color: "black" },
      },
    },
    ...configOverrides,
  };

  fs.writeFileSync(configFile, JSON.stringify(fullConfig, null, 2));

  const coordinator = new GatherCoordinator(configFile);
  const manager = new PresenceManager(coordinator, 10); // 10ms debounce for tests

  return { coordinator, manager, tmpDir };
}

describe("PresenceStateMachine", () => {
  it("transitions through standard cycle phases", () => {
    const sm = new PresenceStateMachine();
    expect(sm.getPhase()).toBe("stopped");

    // Session starts
    expect(sm.transitionSessionStart()).toBe("ready");

    // User asks prompt -> Agent starts
    expect(sm.transitionAgentStart()).toBe("working");

    // Extension shows prompt dialog
    expect(sm.transitionUiPromptStart()).toBe("waiting");
    expect(sm.getUiPromptCount()).toBe(1);

    // Nested prompt dialog opens
    expect(sm.transitionUiPromptStart()).toBe("waiting");
    expect(sm.getUiPromptCount()).toBe(2);

    // First prompt closes
    expect(sm.transitionUiPromptEnd()).toBe("waiting");
    expect(sm.getUiPromptCount()).toBe(1);

    // Second prompt closes -> back to working
    expect(sm.transitionUiPromptEnd()).toBe("working");
    expect(sm.getUiPromptCount()).toBe(0);

    // Normal completion
    sm.observeBeforeSettle("completed");
    expect(sm.transitionAgentSettled()).toBe("ready");

    // Agent starts again, but fails
    sm.transitionAgentStart();
    expect(sm.getPhase()).toBe("working");
    sm.observeBeforeSettle("error");
    expect(sm.transitionAgentSettled()).toBe("error");

    // Aborted turn settles to ready, not error
    sm.transitionAgentStart();
    sm.observeBeforeSettle("aborted");
    expect(sm.transitionAgentSettled()).toBe("ready");

    // Session shutdown with quit -> stopped
    expect(sm.transitionShutdown("quit")).toBe("stopped");
  });

  it("does not stop on session reload or switch", () => {
    const sm = new PresenceStateMachine();
    sm.transitionSessionStart();
    expect(sm.getPhase()).toBe("ready");

    // Reload does not stop
    expect(sm.transitionShutdown("reload")).toBe("ready");
  });
});

describe("PresenceManager lifecycle execution", () => {
  it("dispatches status and variant when hooks are enabled in TUI mode", async () => {
    const { coordinator, manager, tmpDir } = createPresenceTestSetup();
    try {
      const dispatched: Array<{ type: string; data: unknown }> = [];

      const client = coordinator.getClient("pi");
      client.send = async (type, data) => {
        dispatched.push({ type, data });
        return { status: "dispatched" };
      };

      manager.onSessionStart("tui");
      // Flush immediately
      await manager.flushPendingUpdate(true);

      // Should have sent ready state: on + green
      expect(
        dispatched.some(
          (d) => d.type === "status.set" && (d.data as { state: string }).state === "on",
        ),
      ).toBe(true);
      expect(
        dispatched.some(
          (d) => d.type === "variant.set" && (d.data as { color: string }).color === "green",
        ),
      ).toBe(true);

      // Deduplication test: flushing again without state change does not re-send
      const countBefore = dispatched.length;
      await manager.flushPendingUpdate(true);
      expect(dispatched.length).toBe(countBefore);

      // Transition to working on agent_start
      manager.onAgentStart();
      await manager.flushPendingUpdate(true);

      expect(
        dispatched.some(
          (d) => d.type === "status.set" && (d.data as { state: string }).state === "working",
        ),
      ).toBe(true);
      expect(
        dispatched.some(
          (d) => d.type === "variant.set" && (d.data as { color: string }).color === "blue",
        ),
      ).toBe(true);
    } finally {
      coordinator.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("respects allowed modes and ignores non-allowed modes", async () => {
    const { coordinator, manager, tmpDir } = createPresenceTestSetup({
      hooks: {
        enabled: true,
        object: "pi",
        modes: ["tui"], // Only TUI
      },
    });
    try {
      let sendCalled = false;
      const client = coordinator.getClient("pi");
      client.send = async () => {
        sendCalled = true;
        return { status: "dispatched" };
      };

      // Start in JSON mode
      manager.onSessionStart("json");
      await manager.flushPendingUpdate(true);

      expect(sendCalled).toBe(false);
    } finally {
      coordinator.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("respects manual overrides from tool execution", async () => {
    const { coordinator, manager, tmpDir } = createPresenceTestSetup();
    try {
      const dispatched: Array<{ type: string; data: unknown }> = [];

      const client = coordinator.getClient("pi");
      client.send = async (type, data) => {
        dispatched.push({ type, data });
        return { status: "dispatched" };
      };

      manager.setMode("tui");

      // Set manual override on status to "alert" and color to "orange"
      coordinator.setManualOverride("pi", { status: "alert", color: "orange" });

      // Trigger transition to ready
      manager.getStateMachine().transitionSessionStart();
      await manager.flushPendingUpdate(true);

      // Hook should NOT dispatch status.set (overridden) or variant.set (overridden)
      expect(dispatched.length).toBe(0);

      // Next agent_start clears manual overrides
      manager.onAgentStart();
      await manager.flushPendingUpdate(true);

      // Now working and blue are dispatched
      expect(
        dispatched.some(
          (d) => d.type === "status.set" && (d.data as { state: string }).state === "working",
        ),
      ).toBe(true);
      expect(
        dispatched.some(
          (d) => d.type === "variant.set" && (d.data as { color: string }).color === "blue",
        ),
      ).toBe(true);
    } finally {
      coordinator.dispose();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
