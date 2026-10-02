import * as v from "valibot";

export const GatherStateSchema = v.picklist(
  ["off", "on", "question", "alert", "working"],
  "State must be one of: off, on, question, alert, working",
);
export type GatherState = v.InferOutput<typeof GatherStateSchema>;

export const HookStateConfigSchema = v.strictObject({
  state: GatherStateSchema,
  color: v.optional(v.string()),
});
export type HookStateConfig = v.InferOutput<typeof HookStateConfigSchema>;

export const HookStatesConfigSchema = v.strictObject({
  ready: v.optional(HookStateConfigSchema),
  working: v.optional(HookStateConfigSchema),
  waiting: v.optional(HookStateConfigSchema),
  error: v.optional(HookStateConfigSchema),
  stopped: v.optional(HookStateConfigSchema),
});
export type HookStatesConfig = v.InferOutput<typeof HookStatesConfigSchema>;

export const ExtensionModeSchema = v.picklist(
  ["tui", "rpc", "json", "print"],
  "Mode must be one of: tui, rpc, json, print",
);
export type ExtensionMode = v.InferOutput<typeof ExtensionModeSchema>;

export const ObjectCredentialsConfigSchema = v.strictObject({
  urlEnv: v.pipe(v.string("urlEnv must be a string"), v.nonEmpty("urlEnv cannot be empty")),
  secretEnv: v.pipe(
    v.string("secretEnv must be a string"),
    v.nonEmpty("secretEnv cannot be empty"),
  ),
});
export type ObjectCredentialsConfig = v.InferOutput<typeof ObjectCredentialsConfigSchema>;

export const HooksConfigSchema = v.strictObject({
  enabled: v.optional(v.boolean(), false),
  object: v.optional(v.string()),
  modes: v.optional(v.array(ExtensionModeSchema), ["tui"]),
  states: v.optional(HookStatesConfigSchema),
});
export type HooksConfig = v.InferOutput<typeof HooksConfigSchema>;

export const PromptConfigSchema = v.strictObject({
  enabled: v.optional(v.boolean(), true),
});
export type PromptConfig = v.InferOutput<typeof PromptConfigSchema>;

export const PiGatherConfigSchema = v.strictObject({
  $schema: v.optional(v.string()),
  version: v.literal(1, "Config version must be 1"),
  enabled: v.optional(v.boolean(), true),
  defaultObject: v.optional(v.string(), "pi"),
  credentialsFile: v.optional(v.string(), "~/.pi/agent/gather-objects.env"),
  objects: v.optional(v.record(v.string(), ObjectCredentialsConfigSchema), {}),
  hooks: v.optional(HooksConfigSchema, {
    enabled: false,
    modes: ["tui"],
  }),
  prompt: v.optional(PromptConfigSchema, {
    enabled: true,
  }),
});
export type PiGatherConfig = v.InferOutput<typeof PiGatherConfigSchema>;
