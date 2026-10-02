import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });

const result = await Bun.build({
  entrypoints: ["src/gather.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  minify: true,
  external: ["@earendil-works/*", "typebox", "node:*"],
});

if (!result.success) {
  console.error("Build failed:", result.logs);
  process.exit(1);
}

console.log("Built dist/gather.js successfully");
