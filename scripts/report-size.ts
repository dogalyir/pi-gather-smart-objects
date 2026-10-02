import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { buildGatherPromptText } from "../src/prompt.ts";

console.log("=== PI GATHER SMART OBJECTS - SIZE & BUDGET REPORT ===\n");

function formatKb(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KiB (${bytes} bytes)`;
}

// 1. Bundle size
const bundlePath = path.resolve("dist/gather.js");
const bundleBytes = fs.readFileSync(bundlePath);
const bundleGzip = zlib.gzipSync(bundleBytes);

console.log("1. Bundle (dist/gather.js):");
console.log(`   - Uncompressed: ${formatKb(bundleBytes.length)}`);
console.log(`   - Gzipped:      ${formatKb(bundleGzip.length)}`);
const BUNDLE_BUDGET_BYTES = 150 * 1024;
const bundlePass = bundleBytes.length <= BUNDLE_BUDGET_BYTES;
console.log(
  `   - Budget check: ${bundlePass ? "PASSED" : "FAILED"} (<= 150 KiB, usage: ${(
    (bundleBytes.length / BUNDLE_BUDGET_BYTES) *
    100
  ).toFixed(1)}%)\n`,
);

// 2. Schema size
const schemaPath = path.resolve("dist/pi-gather-hooks.schema.json");
const schemaBytes = fs.readFileSync(schemaPath);
const schemaGzip = zlib.gzipSync(schemaBytes);

console.log("2. JSON Schema (dist/pi-gather-hooks.schema.json):");
console.log(`   - Uncompressed: ${formatKb(schemaBytes.length)}`);
console.log(`   - Gzipped:      ${formatKb(schemaGzip.length)}\n`);

// 3. Prompt section size
const promptWithHooks = buildGatherPromptText(true);
const promptWithoutHooks = buildGatherPromptText(false);

console.log("3. Prompt Section (gather_smart_objects):");
console.log(`   - With hooks text:    ${promptWithHooks.length} characters`);
console.log(`   - Without hooks text: ${promptWithoutHooks.length} characters`);
const promptPass = promptWithHooks.length <= 500 && promptWithoutHooks.length <= 500;
console.log(`   - Budget check:       ${promptPass ? "PASSED" : "FAILED"} (< 500 chars)\n`);

// 4. Summary
const allPassed = bundlePass && promptPass;
console.log(`OVERALL BUDGET STATUS: ${allPassed ? "ALL PASSED" : "BUDGET EXCEEDED"}`);

if (!allPassed) {
  process.exit(1);
}
