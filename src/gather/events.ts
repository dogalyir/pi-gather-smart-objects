import { Type, type Static } from "typebox";

export const GATHER_EVENTS = [
  "webhook.ping",
  "info.set",
  "variant.set",
  "status.set",
  "status.reset",
  "signal.set",
  "signal.reset",
  "switch.set_state",
  "switch.toggle",
  "counter.set",
  "counter.increment",
  "counter.decrement",
  "counter.reset",
  "activity.add",
  "activity.remove",
  "activity.clear",
] as const;

export type GatherEventType = (typeof GATHER_EVENTS)[number];

export const GatherEventSchema = Type.Union([
  Type.Literal("webhook.ping"),
  Type.Literal("info.set"),
  Type.Literal("variant.set"),
  Type.Literal("status.set"),
  Type.Literal("status.reset"),
  Type.Literal("signal.set"),
  Type.Literal("signal.reset"),
  Type.Literal("switch.set_state"),
  Type.Literal("switch.toggle"),
  Type.Literal("counter.set"),
  Type.Literal("counter.increment"),
  Type.Literal("counter.decrement"),
  Type.Literal("counter.reset"),
  Type.Literal("activity.add"),
  Type.Literal("activity.remove"),
  Type.Literal("activity.clear"),
]);

export const GatherDataSchema = Type.Object({
  name: Type.Optional(Type.String({ description: "Object name (info.set, max 120 chars)" })),
  description: Type.Optional(
    Type.String({ description: "Object description (info.set, max 2000 chars)" }),
  ),
  color: Type.Optional(
    Type.String({ description: "Color variant (variant.set, from ping colors)" }),
  ),
  state: Type.Optional(
    Type.String({
      description:
        "State for status.set ('off'|'on'|'question'|'alert'|'working') or signal.set ('off'|'on'|'alert')",
    }),
  ),
  on: Type.Optional(Type.Boolean({ description: "Switch state (switch.set_state: true/false)" })),
  count: Type.Optional(
    Type.Integer({ minimum: 0, description: "Counter value (counter.set >= 0)" }),
  ),
  by: Type.Optional(
    Type.Integer({
      minimum: 1,
      description: "Counter step (counter.increment / decrement >= 1)",
    }),
  ),
  id: Type.Optional(
    Type.String({
      description: "Stable ID for activity item (activity.add / remove, max 128 chars)",
    }),
  ),
  text: Type.Optional(Type.String({ description: "Activity text (activity.add, max 500 chars)" })),
  url: Type.Optional(
    Type.String({
      description: "Optional activity link URL (activity.add, http(s), max 2048 chars)",
    }),
  ),
});

export type GatherDataInput = Static<typeof GatherDataSchema>;

export const GatherSendParamsSchema = Type.Object({
  object: Type.Optional(
    Type.String({
      description:
        "Configured object name alias from pi-gather-hooks.json (defaults to defaultObject)",
    }),
  ),
  event: GatherEventSchema,
  data: Type.Optional(GatherDataSchema),
});

export type GatherSendParams = Static<typeof GatherSendParamsSchema>;

export const STATUS_STATES = ["off", "on", "question", "alert", "working"] as const;
export const SIGNAL_STATES = ["off", "on", "alert"] as const;

export function validateEventPayload(
  event: GatherEventType,
  data?: GatherDataInput,
): Record<string, unknown> {
  const d = data ?? {};

  switch (event) {
    case "webhook.ping":
    case "status.reset":
    case "signal.reset":
    case "switch.toggle":
    case "counter.reset":
    case "activity.clear":
      return {};

    case "info.set": {
      const payload: Record<string, unknown> = {};
      if (d.name !== undefined) {
        if (d.name.length > 120) {
          throw new Error("info.set: 'name' must be <= 120 characters");
        }
        payload.name = d.name;
      }
      if (d.description !== undefined) {
        if (d.description.length > 2000) {
          throw new Error("info.set: 'description' must be <= 2000 characters");
        }
        payload.description = d.description;
      }
      if (Object.keys(payload).length === 0) {
        throw new Error("info.set requires at least one of 'name' or 'description'");
      }
      return payload;
    }

    case "variant.set": {
      if (!d.color || typeof d.color !== "string" || d.color.trim() === "") {
        throw new Error("variant.set requires a non-empty string in 'color'");
      }
      return { color: d.color.trim().toLowerCase() };
    }

    case "status.set": {
      if (!d.state || !STATUS_STATES.includes(d.state as (typeof STATUS_STATES)[number])) {
        throw new Error(`status.set requires 'state' to be one of: ${STATUS_STATES.join(", ")}`);
      }
      return { state: d.state };
    }

    case "signal.set": {
      if (!d.state || !SIGNAL_STATES.includes(d.state as (typeof SIGNAL_STATES)[number])) {
        throw new Error(`signal.set requires 'state' to be one of: ${SIGNAL_STATES.join(", ")}`);
      }
      return { state: d.state };
    }

    case "switch.set_state": {
      if (typeof d.on !== "boolean") {
        throw new Error("switch.set_state requires boolean 'on'");
      }
      return { on: d.on };
    }

    case "counter.set": {
      if (typeof d.count !== "number" || !Number.isInteger(d.count) || d.count < 0) {
        throw new Error("counter.set requires integer 'count' >= 0");
      }
      return { count: d.count };
    }

    case "counter.increment": {
      const by = d.by ?? 1;
      if (typeof by !== "number" || !Number.isInteger(by) || by < 1) {
        throw new Error("counter.increment requires integer 'by' >= 1");
      }
      return { by };
    }

    case "counter.decrement": {
      const by = d.by ?? 1;
      if (typeof by !== "number" || !Number.isInteger(by) || by < 1) {
        throw new Error("counter.decrement requires integer 'by' >= 1");
      }
      return { by };
    }

    case "activity.add": {
      if (!d.id || typeof d.id !== "string" || d.id.trim() === "") {
        throw new Error("activity.add requires a non-empty string 'id'");
      }
      if (d.id.length > 128) {
        throw new Error("activity.add: 'id' must be <= 128 characters");
      }
      if (!d.text || typeof d.text !== "string" || d.text.trim() === "") {
        throw new Error("activity.add requires a non-empty string 'text'");
      }
      if (d.text.length > 500) {
        throw new Error("activity.add: 'text' must be <= 500 characters");
      }
      const payload: Record<string, unknown> = {
        id: d.id.trim(),
        text: d.text.trim(),
      };
      if (d.url !== undefined && d.url.trim() !== "") {
        const u = d.url.trim();
        if (u.length > 2048) {
          throw new Error("activity.add: 'url' must be <= 2048 characters");
        }
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            throw new Error("activity.add: 'url' must use http or https");
          }
          payload.url = u;
        } catch (err) {
          throw new Error(
            `activity.add: invalid URL '${u}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return payload;
    }

    case "activity.remove": {
      if (!d.id || typeof d.id !== "string" || d.id.trim() === "") {
        throw new Error("activity.remove requires a non-empty string 'id'");
      }
      if (d.id.length > 128) {
        throw new Error("activity.remove: 'id' must be <= 128 characters");
      }
      return { id: d.id.trim() };
    }
  }
}
