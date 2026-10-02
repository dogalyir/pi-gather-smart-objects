import type { AgentActivityOutcome, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ExtensionMode, HookStateConfig } from "../config/schema.ts";
import type { GatherCoordinator } from "./coordinator.ts";

export type PresenceLifecyclePhase = "ready" | "working" | "waiting" | "error" | "stopped";

export const DEFAULT_STATE_MAPPINGS: Record<PresenceLifecyclePhase, HookStateConfig> = {
  ready: { state: "on", color: "green" },
  working: { state: "working", color: "blue" },
  waiting: { state: "question", color: "yellow" },
  error: { state: "alert", color: "red" },
  stopped: { state: "off", color: "black" },
};

export class PresenceStateMachine {
  private phase: PresenceLifecyclePhase = "stopped";
  private uiPromptCount = 0;
  private lastObservedOutcome: AgentActivityOutcome | null = null;

  getPhase(): PresenceLifecyclePhase {
    return this.phase;
  }

  getUiPromptCount(): number {
    return this.uiPromptCount;
  }

  getLastOutcome(): AgentActivityOutcome | null {
    return this.lastObservedOutcome;
  }

  transitionSessionStart(): PresenceLifecyclePhase {
    this.phase = "ready";
    this.uiPromptCount = 0;
    this.lastObservedOutcome = null;
    return this.phase;
  }

  transitionAgentStart(): PresenceLifecyclePhase {
    this.phase = "working";
    this.uiPromptCount = 0;
    this.lastObservedOutcome = null;
    return this.phase;
  }

  transitionUiPromptStart(): PresenceLifecyclePhase {
    this.uiPromptCount++;
    this.phase = "waiting";
    return this.phase;
  }

  transitionUiPromptEnd(): PresenceLifecyclePhase {
    if (this.uiPromptCount > 0) {
      this.uiPromptCount--;
    }
    if (this.uiPromptCount === 0) {
      // Revert to working if inside turn, else ready
      this.phase = "working";
    }
    return this.phase;
  }

  observeBeforeSettle(outcome: AgentActivityOutcome): void {
    this.lastObservedOutcome = outcome;
  }

  transitionAgentSettled(): PresenceLifecyclePhase {
    if (this.lastObservedOutcome === "error") {
      this.phase = "error";
    } else {
      // Completed or aborted -> ready
      this.phase = "ready";
    }
    this.uiPromptCount = 0;
    return this.phase;
  }

  transitionShutdown(reason: string): PresenceLifecyclePhase {
    if (reason === "quit") {
      this.phase = "stopped";
    }
    // reload / switch keeps previous state
    return this.phase;
  }
}

export class PresenceManager {
  private coordinator: GatherCoordinator;
  private stateMachine = new PresenceStateMachine();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceMs: number;
  private currentMode: ExtensionMode = "tui";

  constructor(coordinator: GatherCoordinator, debounceMs = 150) {
    this.coordinator = coordinator;
    this.debounceMs = debounceMs;
  }

  getStateMachine(): PresenceStateMachine {
    return this.stateMachine;
  }

  setMode(mode: ExtensionMode): void {
    this.currentMode = mode;
  }

  private isHookExecutionAllowed(): boolean {
    const cfg = this.coordinator.getConfigResult().config;
    if (cfg.enabled === false) return false;
    if (!cfg.hooks?.enabled) return false;
    if (this.coordinator.isAutomationPaused()) return false;

    const allowedModes = cfg.hooks.modes ?? ["tui"];
    if (!allowedModes.includes(this.currentMode)) return false;

    return true;
  }

  private resolveTargetObject(): string | undefined {
    const cfg = this.coordinator.getConfigResult().config;
    const target = cfg.hooks?.object ?? cfg.defaultObject ?? "pi";
    const declared = Object.keys(cfg.objects ?? {});
    return declared.includes(target) ? target : undefined;
  }

  private getEffectiveMapping(phase: PresenceLifecyclePhase): HookStateConfig {
    const cfg = this.coordinator.getConfigResult().config;
    const custom = cfg.hooks?.states?.[phase];
    return custom ?? DEFAULT_STATE_MAPPINGS[phase];
  }

  async flushPendingUpdate(immediate = false): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (!this.isHookExecutionAllowed()) {
      return;
    }

    const objectName = this.resolveTargetObject();
    if (!objectName) {
      return;
    }

    const creds = this.coordinator.getConfigResult().credentials[objectName];
    if (!creds) {
      return;
    }

    // Check / Acquire lock
    const lockMgr = this.coordinator.getLockManager();
    const acquired = lockMgr.tryAcquire(objectName, creds.url);
    if (!acquired) {
      return; // Another process owns this object
    }

    const executeDispatch = async () => {
      const phase = this.stateMachine.getPhase();
      const mapping = this.getEffectiveMapping(phase);
      const manualOverride = this.coordinator.getManualOverride(objectName);
      const lastStatus = this.coordinator.getLastReportedStatus(objectName);

      const client = this.coordinator.getClient(objectName);

      // 1. Status dispatch (if not overridden manually and changed)
      const targetState = mapping.state;
      const shouldSendStatus = !manualOverride?.status && lastStatus.status !== targetState;

      if (shouldSendStatus) {
        try {
          await client.send("status.set", { state: targetState });
          this.coordinator.setLastReportedStatus(objectName, {
            status: targetState,
          });
        } catch (err) {
          // Non-blocking log
          console.error(
            `[pi-gather-smart-objects] Failed to push status '${targetState}' to '${objectName}': ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      // 2. Variant / Color dispatch (if specified, not overridden manually, and changed)
      const targetColor = mapping.color;
      if (targetColor) {
        const shouldSendColor = !manualOverride?.color && lastStatus.color !== targetColor;

        if (shouldSendColor) {
          try {
            await client.send("variant.set", { color: targetColor });
            this.coordinator.setLastReportedStatus(objectName, {
              color: targetColor,
            });
          } catch (err) {
            console.error(
              `[pi-gather-smart-objects] Failed to push color '${targetColor}' to '${objectName}': ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }
    };

    if (immediate) {
      await this.coordinator.enqueue(objectName, executeDispatch);
    } else {
      this.coordinator.enqueue(objectName, executeDispatch);
    }
  }

  scheduleUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flushPendingUpdate(false);
    }, this.debounceMs);
  }

  // Lifecycle event handlers
  onSessionStart(mode: ExtensionMode): void {
    this.setMode(mode);
    this.stateMachine.transitionSessionStart();
    this.scheduleUpdate();
  }

  onAgentStart(): void {
    // New model turn starts: clear manual overrides from previous cycle
    const obj = this.resolveTargetObject();
    if (obj) {
      this.coordinator.clearManualOverrides(obj);
    }
    this.stateMachine.transitionAgentStart();
    this.scheduleUpdate();
  }

  onUiPromptStart(): void {
    this.stateMachine.transitionUiPromptStart();
    this.scheduleUpdate();
  }

  onUiPromptEnd(): void {
    this.stateMachine.transitionUiPromptEnd();
    this.scheduleUpdate();
  }

  onAgentBeforeSettle(outcome: AgentActivityOutcome): void {
    this.stateMachine.observeBeforeSettle(outcome);
  }

  onAgentSettled(): void {
    this.stateMachine.transitionAgentSettled();
    this.scheduleUpdate();
  }

  async onSessionShutdown(reason: string): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.stateMachine.transitionShutdown(reason);
    if (reason === "quit") {
      await this.flushPendingUpdate(true);
    }
  }
}

export function bindPresenceHooks(
  pi: ExtensionAPI,
  coordinator: GatherCoordinator,
): PresenceManager {
  const presence = new PresenceManager(coordinator);

  pi.on("session_start", (_event, ctx) => {
    presence.onSessionStart(ctx.mode);
  });

  pi.on("agent_start", () => {
    presence.onAgentStart();
  });

  pi.on("ui_prompt_start", () => {
    presence.onUiPromptStart();
  });

  pi.on("ui_prompt_end", () => {
    presence.onUiPromptEnd();
  });

  pi.on("agent_before_settle", (event) => {
    presence.onAgentBeforeSettle(event.outcome);
  });

  pi.on("agent_settled", () => {
    presence.onAgentSettled();
  });

  pi.on("session_shutdown", async (event) => {
    await presence.onSessionShutdown(event.reason);
  });

  return presence;
}
