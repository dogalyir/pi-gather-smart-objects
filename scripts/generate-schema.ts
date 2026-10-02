import { mkdir } from "node:fs/promises";
import { toJsonSchema } from "@valibot/to-json-schema";
import { PiGatherConfigSchema } from "../src/config/schema.ts";
import packageJson from "../package.json" with { type: "json" };

const schema = toJsonSchema(PiGatherConfigSchema);

// Attach metadata
const fullSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: `https://unpkg.com/${packageJson.name}@${packageJson.version}/dist/pi-gather-hooks.schema.json`,
  title: "PiGatherHooksConfig",
  description: "Configuration schema for pi-gather-smart-objects extension",
  ...schema,
};

await mkdir("dist", { recursive: true });
await Bun.write("dist/pi-gather-hooks.schema.json", `${JSON.stringify(fullSchema, null, 2)}\n`);

console.log("Generated dist/pi-gather-hooks.schema.json successfully");
