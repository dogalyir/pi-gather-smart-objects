import type { JsonValue } from "@earendil-works/pi-ai";
import type { AgentToolResult, ExtensionToolContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type TSchema, Type } from "typebox";
import {
  type GatherEventType,
  GatherSendParamsSchema,
  validateEventPayload,
} from "./gather/events.ts";
import type { GatherCoordinator } from "./runtime/coordinator.ts";

export const GatherSendResultSchema = Type.Object({
  success: Type.Boolean(),
  object: Type.String(),
  event: Type.String(),
  status: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  error: Type.Optional(Type.String()),
});

function defineTool<TParams extends TSchema, TDetails = unknown, TState = any>(
  tool: ToolDefinition<TParams, TDetails, TState>
): ToolDefinition<TParams, TDetails, TState> {
  return tool;
}

function formatResult(
  text: string,
  structured: Record<string, JsonValue>,
  details: Record<string, unknown>,
  isError = false,
): AgentToolResult<Record<string, unknown>> {
  return {
    content: [{ type: "text", text }],
    structuredContent: structured,
    details,
    isError: isError ? true : undefined,
  };
}

export function createGatherSendTool(coordinator: GatherCoordinator) {
  return defineTool({
    name: "gather_send",
    label: "Gather Send",
    description:
      "Inspect or dispatch events to Gather 2.0 Smart Objects. Supported events: webhook.ping, " +
      "status.set, status.reset, signal.set, signal.reset, activity.add, activity.remove, " +
      "activity.clear, counter.set, counter.increment, counter.decrement, counter.reset, " +
      "switch.set_state, switch.toggle, variant.set (color), info.set (name/description). " +
      "Run webhook.ping first if you need to discover available capabilities and colors.",
    promptSnippet:
      "Inspect or dispatch events to Gather Smart Objects (status, activity feed, counters, switches, colors, info)",
    promptGuidelines: [
      "Use gather_send when requested to control Gather Smart Objects or publish authorized status.",
      "Call webhook.ping to inspect the object's preset and accepted colors before sending variants.",
      "Activity feed entries are visible to the entire space: never send passwords, API keys, or confidential information.",
      "Use a stable id for activity.add (e.g. 'pr-123') so subsequent updates refresh the item instead of creating duplicates.",
    ],
    parameters: GatherSendParamsSchema,
    outputSchema: GatherSendResultSchema,
    annotations: {
      readOnlyHint: false,
      openWorldHint: true,
      destructiveHint: true,
      idempotentHint: false,
    },
    async execute(
      _toolCallId: string,
      params,
      signal?: AbortSignal,
      _onUpdate?: unknown,
      _ctx?: ExtensionToolContext
    ): Promise<AgentToolResult<Record<string, unknown>>> {
      const config = coordinator.getConfigResult().config;
      if (config.enabled === false) {
        return formatResult(
          "Gather integration is disabled in configuration (enabled: false).",
          {
            success: false,
            object: params.object ?? "default",
            event: params.event,
            error: "Integration disabled",
          },
          { error: "Integration disabled" },
          true,
        );
      }

      const targetObject = params.object ?? config.defaultObject ?? "pi";

      let client;
      try {
        client = coordinator.getClient(targetObject);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return formatResult(
          `Gather configuration error: ${errorMsg}`,
          {
            success: false,
            object: targetObject,
            event: params.event,
            error: errorMsg,
          },
          { error: errorMsg },
          true,
        );
      }

      let payload: Record<string, unknown>;
      try {
        payload = validateEventPayload(params.event as GatherEventType, params.data);
      } catch (err) {
        const validationError = err instanceof Error ? err.message : String(err);
        return formatResult(
          `Event validation error for '${params.event}': ${validationError}`,
          {
            success: false,
            object: targetObject,
            event: params.event,
            error: validationError,
          },
          { error: validationError },
          true,
        );
      }

      try {
        if (params.event === "webhook.ping") {
          const pingResult = await coordinator.enqueue(targetObject, () => client.ping({ signal }));

          // Build human-friendly summary
          const lines: string[] = [
            `Gather object '${targetObject}' (preset: ${pingResult.preset ?? "none"}):`,
            `- Space ID: ${pingResult.spaceId}`,
            `- Object ID: ${pingResult.objectId}`,
            `- Capabilities: ${Object.keys(pingResult.capabilities).join(", ")}`,
          ];

          if (pingResult.colors && pingResult.colors.length > 0) {
            lines.push(`- Available colors: ${pingResult.colors.join(", ")}`);
          }

          // Show current status state if available
          const capObj = pingResult.capabilities as Record<string, Record<string, unknown>>;
          if (capObj.status?.state) {
            lines.push(`- Current status: ${capObj.status.state}`);
          }
          if (capObj.variant?.color) {
            lines.push(`- Current color: ${capObj.variant.color}`);
          }

          // Show recent activity (capped to 5 items)
          if (Array.isArray(capObj.activity?.entries)) {
            const entries = capObj.activity.entries as Array<{
              id: string;
              text: string;
              at?: number;
            }>;
            lines.push(`- Recent activity (${entries.length} items):`);
            const recent = entries.slice(-5);
            for (const item of recent) {
              lines.push(`  * [${item.id}] ${item.text}`);
            }
          }

          const structuredDetails: Record<string, JsonValue> = {
            preset: (pingResult.preset as string) ?? null,
            capabilities: pingResult.capabilities as unknown as JsonValue,
            colors: (pingResult.colors as unknown as JsonValue) ?? [],
          };

          return formatResult(
            lines.join("\n"),
            {
              success: true,
              object: targetObject,
              event: "webhook.ping",
              status: "pong",
              details: structuredDetails,
            },
            structuredDetails,
          );
        }

        // Color variant validation against ping colors
        if (params.event === "variant.set") {
          const reqColor = payload.color as string;
          try {
            const meta = await coordinator.getMetadata(targetObject);
            if (meta.colors && meta.colors.length > 0 && !meta.colors.includes(reqColor)) {
              return formatResult(
                `Color '${reqColor}' is not in the object's supported colors: ${meta.colors.join(
                  ", ",
                )}`,
                {
                  success: false,
                  object: targetObject,
                  event: "variant.set",
                  error: `Unsupported color: ${reqColor}`,
                  details: { supportedColors: (meta.colors as unknown as JsonValue) ?? [] },
                },
                { supportedColors: meta.colors },
                true,
              );
            }
          } catch {
            // If discovery fails, proceed with dispatch attempt
          }

          // Record manual override so automatic hooks do not immediately reset the color
          coordinator.setManualOverride(targetObject, { color: reqColor });
        }

        // Status override tracking
        if (params.event === "status.set") {
          coordinator.setManualOverride(targetObject, {
            status: payload.state as string,
          });
        }

        // Dispatch event via serial queue
        const sendResult = await coordinator.enqueue(targetObject, () =>
          client.send(params.event as GatherEventType, payload, { signal }),
        );

        let confirmation = `Dispatched '${params.event}' to object '${targetObject}'. Result status: ${sendResult.status}.`;
        if (params.event === "status.set" || params.event === "variant.set") {
          confirmation +=
            " (Manual override active: automated presence hooks will pause on this property until next cycle)";
        }

        return formatResult(
          confirmation,
          {
            success: true,
            object: targetObject,
            event: params.event,
            status: sendResult.status,
            details: payload as unknown as JsonValue,
          },
          {
            status: sendResult.status,
            payload,
          },
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return formatResult(
          `Failed to dispatch '${params.event}' to '${targetObject}': ${msg}`,
          {
            success: false,
            object: targetObject,
            event: params.event,
            error: msg,
          },
          { error: msg },
          true,
        );
      }
    },
  });
}
