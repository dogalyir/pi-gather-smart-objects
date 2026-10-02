import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGatherCommand } from "./commands.ts";
import { GATHER_PROMPT_SECTION_KEY, getPromptSectionContent } from "./prompt.ts";
import { GatherCoordinator } from "./runtime/coordinator.ts";
import { bindPresenceHooks } from "./runtime/presence.ts";
import { createGatherSendTool } from "./tool.ts";

export default function gatherExtension(pi: ExtensionAPI): void {
  // Synchronous, safe factory: no network calls, timers, or long-lived sockets
  const coordinator = new GatherCoordinator();

  // Register the single model-facing tool
  const sendTool = createGatherSendTool(coordinator);
  pi.registerTool(sendTool);

  // Register the human command
  registerGatherCommand(pi, coordinator);

  // In before_agent_start: inject or remove the prompt section
  pi.on("before_agent_start", (event) => {
    const isToolActive = event.systemPromptOptions.selectedTools.includes("gather_send");
    const cfg = coordinator.getConfigResult().config;

    const promptText = getPromptSectionContent({
      isToolActive,
      configEnabled: cfg.enabled,
      promptEnabled: cfg.prompt?.enabled,
      hooksEnabled: cfg.hooks?.enabled && !coordinator.isAutomationPaused(),
    });

    if (promptText) {
      event.systemPromptOptions.sections[GATHER_PROMPT_SECTION_KEY] = promptText;
    } else {
      delete event.systemPromptOptions.sections[GATHER_PROMPT_SECTION_KEY];
    }
  });

  // Session lifecycle boundaries & presence hooks
  pi.on("session_start", (_event, _ctx) => {
    coordinator.reload();
  });

  // Bind automated presence lifecycle hooks
  bindPresenceHooks(pi, coordinator);

  pi.on("session_shutdown", (_event) => {
    coordinator.dispose();
  });
}
