import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { getPromptSectionContent } from "./prompt.ts";
import type { GatherCoordinator } from "./runtime/coordinator.ts";

export function registerGatherCommand(pi: ExtensionAPI, coordinator: GatherCoordinator): void {
  pi.registerCommand("gather", {
    description: "Inspect and manage Gather Smart Objects integration",
    handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
      const args = rawArgs.trim().split(/\s+/).filter(Boolean);
      const sub = args[0]?.toLowerCase();

      if (!sub) {
        // Default summary view
        const diag = coordinator.getDiagnostics();
        const lines: string[] = [
          "Gather Smart Objects Status:",
          `- Config loaded: ${diag.configLoaded ? diag.configPath : "No (using defaults)"}`,
          `- Enabled: ${diag.enabled}`,
          `- Default object: ${diag.defaultObject ?? "none"}`,
          `- Automation paused: ${diag.automationPaused}`,
        ];

        const objs = diag.objects as Record<string, Record<string, unknown>>;
        const objNames = Object.keys(objs);
        if (objNames.length === 0) {
          lines.push("- No objects configured in pi-gather-hooks.json");
        } else {
          lines.push("- Configured objects:");
          for (const [name, info] of Object.entries(objs)) {
            const lock = info.lockStatus as
              | { ownedByMe?: boolean; ownerPid?: number; locked?: boolean }
              | undefined;
            const lockStr = lock?.locked
              ? lock.ownedByMe
                ? "locked (owned by this process)"
                : `locked (owned by PID ${lock.ownerPid})`
              : "unlocked";
            lines.push(
              `  * ${name}: credentials=${info.hasCredentials ? "yes" : "missing"}, preset=${info.preset}, lock=${lockStr}`,
            );
          }
        }

        lines.push("");
        lines.push(
          "Subcommands: /gather ping [obj] | /gather debug | /gather reload | /gather auto [pause|resume]",
        );

        if (ctx.hasUI) {
          ctx.ui.notify(lines.join("\n"), "info");
        } else {
          console.log(lines.join("\n"));
        }
        return;
      }

      if (sub === "reload") {
        try {
          const res = coordinator.reload();
          const msg = `Gather configuration reloaded: ${
            res.configPath ? res.configPath : "default config (no file found)"
          }`;
          if (ctx.hasUI) ctx.ui.notify(msg, "info");
          else console.log(msg);
        } catch (err) {
          const msg = `Failed to reload Gather config: ${
            err instanceof Error ? err.message : String(err)
          }`;
          if (ctx.hasUI) ctx.ui.notify(msg, "error");
          else console.error(msg);
        }
        return;
      }

      if (sub === "auto") {
        const action = args[1]?.toLowerCase();
        if (action === "pause") {
          coordinator.setAutomationPaused(true);
          const msg = "Automated presence hooks paused.";
          if (ctx.hasUI) ctx.ui.notify(msg, "info");
          else console.log(msg);
        } else if (action === "resume") {
          coordinator.setAutomationPaused(false);
          coordinator.clearManualOverrides();
          const msg = "Automated presence hooks resumed and manual overrides cleared.";
          if (ctx.hasUI) ctx.ui.notify(msg, "info");
          else console.log(msg);
        } else {
          const msg = "Usage: /gather auto pause | /gather auto resume";
          if (ctx.hasUI) ctx.ui.notify(msg, "warning");
          else console.log(msg);
        }
        return;
      }

      if (sub === "ping") {
        const targetObj = args[1] ?? coordinator.getConfigResult().config.defaultObject ?? "pi";
        try {
          if (ctx.hasUI) ctx.ui.notify(`Pinging Gather object '${targetObj}'...`, "info");
          const client = coordinator.getClient(targetObj);
          const pingResult = await client.ping();

          const lines = [
            `Gather object '${targetObj}' response:`,
            `- Status: ${pingResult.status}`,
            `- Object ID: ${pingResult.objectId}`,
            `- Space ID: ${pingResult.spaceId}`,
            `- Preset: ${pingResult.preset ?? "none"}`,
            `- Capabilities: ${Object.keys(pingResult.capabilities).join(", ")}`,
            `- Colors: ${pingResult.colors?.join(", ") ?? "none"}`,
          ];
          if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
          else console.log(lines.join("\n"));
        } catch (err) {
          const msg = `Ping failed for '${targetObj}': ${
            err instanceof Error ? err.message : String(err)
          }`;
          if (ctx.hasUI) ctx.ui.notify(msg, "error");
          else console.error(msg);
        }
        return;
      }

      if (sub === "debug") {
        const activeTools = pi.getActiveTools();
        const hasGatherSend = activeTools.includes("gather_send");
        const cfg = coordinator.getConfigResult().config;

        const promptText = getPromptSectionContent({
          isToolActive: hasGatherSend,
          configEnabled: cfg.enabled,
          promptEnabled: cfg.prompt?.enabled,
          hooksEnabled: cfg.hooks?.enabled && !coordinator.isAutomationPaused(),
        });

        const lines = [
          "=== GATHER DEBUG INFO ===",
          `Active tools in session: ${activeTools.join(", ")}`,
          `'gather_send' tool active: ${hasGatherSend ? "YES" : "NO"}`,
          `Config enabled: ${cfg.enabled}`,
          `Prompt enabled: ${cfg.prompt?.enabled}`,
          `Hooks enabled: ${cfg.hooks?.enabled}`,
          `Automation paused: ${coordinator.isAutomationPaused()}`,
          "",
          "--- INJECTED PROMPT SECTION (gather_smart_objects) ---",
          promptText ?? "(NOT INJECTED - conditions not met)",
          "",
          "--- COORDINATOR DIAGNOSTICS ---",
          JSON.stringify(coordinator.getDiagnostics(), null, 2),
        ];

        if (ctx.hasUI) ctx.ui.notify(lines.join("\n"), "info");
        else console.log(lines.join("\n"));
        return;
      }

      const msg = `Unknown subcommand '/gather ${sub}'. Available: ping, debug, reload, auto`;
      if (ctx.hasUI) ctx.ui.notify(msg, "warning");
      else console.log(msg);
    },
  });
}
