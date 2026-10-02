import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

console.log("Running package verification...");

// 1. Pack dry-run to get tarball info
const packRaw = execSync("npm pack --json --dry-run", {
  encoding: "utf-8",
});

// prepack script output might prepend log lines before JSON
const jsonStart = packRaw.indexOf("[");
const jsonEnd = packRaw.lastIndexOf("]");
if (jsonStart === -1 || jsonEnd === -1) {
  console.error("Could not find JSON array in npm pack output:\n", packRaw);
  process.exit(1);
}

const packJson = JSON.parse(packRaw.slice(jsonStart, jsonEnd + 1));
const entry = packJson[0];

if (!entry) {
  console.error("npm pack produced no entries!");
  process.exit(1);
}

console.log(`Package: ${entry.name}@${entry.version}`);
console.log(`Unpacked size: ${(entry.size / 1024).toFixed(1)} KB`);
console.log(`Tarball size: ${(entry.unpackedSize / 1024).toFixed(1)} KB`);

// 2. Allowlist verification
const ALLOWED_FILES = new Set([
  "package.json",
  "dist/gather.js",
  "dist/pi-gather-hooks.schema.json",
  "README.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
]);

const packagedFiles = (entry.files as Array<{ path: string }>).map((f) => f.path);
console.log(`Packaged files (${packagedFiles.length}):`, packagedFiles);

for (const f of packagedFiles) {
  if (!ALLOWED_FILES.has(f)) {
    console.error(`Unexpected file packaged: ${f}`);
    process.exit(1);
  }
}

for (const expected of ALLOWED_FILES) {
  if (!packagedFiles.includes(expected)) {
    console.error(`Expected file missing from package: ${expected}`);
    process.exit(1);
  }
}

// 3. Inspect dist/gather.js for forbidden imports
const bundlePath = path.resolve("dist/gather.js");
if (!fs.existsSync(bundlePath)) {
  console.error("dist/gather.js does not exist!");
  process.exit(1);
}

const bundleContent = fs.readFileSync(bundlePath, "utf-8");

// Search for import statements
const importRegex = /from\s*["']([^"']+)["']/g;
let match;
const externalImports = new Set<string>();

while ((match = importRegex.exec(bundleContent)) !== null) {
  externalImports.add(match[1]!);
}

console.log("External imports in bundle:", Array.from(externalImports));

for (const imp of externalImports) {
  const isAllowed =
    imp.startsWith("node:") || imp.startsWith("@earendil-works/") || imp === "typebox";

  if (!isAllowed) {
    console.error(
      `Forbidden external import detected in bundle: ${imp}. ` +
        `Only node:* and Pi host packages (@earendil-works/*, typebox) may be external.`,
    );
    process.exit(1);
  }
}

// 4. Verify schema is valid JSON
const schemaPath = path.resolve("dist/pi-gather-hooks.schema.json");
if (!fs.existsSync(schemaPath)) {
  console.error("dist/pi-gather-hooks.schema.json does not exist!");
  process.exit(1);
}

const schemaJson = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
if (!schemaJson.$schema || !schemaJson.$id || !schemaJson.properties) {
  console.error("dist/pi-gather-hooks.schema.json has invalid schema structure!");
  process.exit(1);
}

console.log("Package verification PASSED successfully!");
