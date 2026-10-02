import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import packageJson from "../package.json" with { type: "json" };

describe("Package Distribution & Integrity", () => {
  it("has valid package metadata and exports", () => {
    expect(packageJson.name).toBe("pi-gather-smart-objects");
    expect(packageJson.type).toBe("module");
    expect(packageJson.keywords).toContain("pi-package");
    expect(packageJson.main).toBe("./dist/gather.js");
    expect(packageJson.exports["."]).toBe("./dist/gather.js");
    expect(packageJson.exports["./schema.json"]).toBe("./dist/pi-gather-hooks.schema.json");
    expect(packageJson.pi.extensions).toContain("./dist/gather.js");
    expect(packageJson.publishConfig.access).toBe("public");
  });

  it("declares Pi host packages as peerDependencies, not regular dependencies", () => {
    expect(packageJson.peerDependencies["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(packageJson.peerDependencies["@earendil-works/pi-ai"]).toBe("*");
    expect((packageJson as Record<string, unknown>).dependencies).toBeUndefined();
  });

  it("bundles dist/gather.js within the 150 KiB budget", () => {
    const bundlePath = path.resolve("dist/gather.js");
    expect(fs.existsSync(bundlePath)).toBe(true);

    const stats = fs.statSync(bundlePath);
    expect(stats.size).toBeLessThan(150 * 1024);
  });

  it("exports a valid JSON schema with version 1", () => {
    const schemaPath = path.resolve("dist/pi-gather-hooks.schema.json");
    expect(fs.existsSync(schemaPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
    expect(content.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(content.title).toBe("PiGatherHooksConfig");
    expect(content.properties.version.const).toBe(1);
    expect(content.properties.hooks.properties.enabled.type).toBe("boolean");
  });

  it("verifies package allowlist contains only necessary distribution files", () => {
    const expectedFiles = [
      "dist/gather.js",
      "dist/pi-gather-hooks.schema.json",
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
    ];

    for (const f of expectedFiles) {
      expect(packageJson.files).toContain(f);
      expect(fs.existsSync(path.resolve(f))).toBe(true);
    }

    // Ensure no source files or sensitive configs are in files allowlist
    expect(packageJson.files).not.toContain("src");
    expect(packageJson.files).not.toContain("test");
    expect(packageJson.files).not.toContain("bun.lock");
  });
});
