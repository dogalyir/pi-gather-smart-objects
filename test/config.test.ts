import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as v from "valibot";
import {
  expandHome,
  loadConfig,
  parseEnvFile,
  redactSecret,
  validateFilePermissions,
  validateGatherUrl,
} from "../src/config/load.ts";
import { PiGatherConfigSchema } from "../src/config/schema.ts";

describe("PiGatherConfigSchema (Valibot)", () => {
  it("validates a minimal valid configuration", () => {
    const minimal = { version: 1 };
    const result = v.safeParse(PiGatherConfigSchema, minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.output.version).toBe(1);
      expect(result.output.enabled).toBe(true);
      expect(result.output.defaultObject).toBe("pi");
      expect(result.output.hooks?.enabled).toBe(false);
      expect(result.output.prompt?.enabled).toBe(true);
    }
  });

  it("validates a full configuration", () => {
    const full = {
      $schema: "./schema.json",
      version: 1,
      enabled: true,
      defaultObject: "pi",
      credentialsFile: "~/.pi/agent/gather.env",
      objects: {
        pi: {
          urlEnv: "GSO_PI_URL",
          secretEnv: "GSO_PI_SECRET",
        },
      },
      hooks: {
        enabled: true,
        object: "pi",
        modes: ["tui"],
        states: {
          ready: { state: "on", color: "green" },
          working: { state: "working", color: "blue" },
          waiting: { state: "question", color: "yellow" },
          error: { state: "alert", color: "red" },
          stopped: { state: "off", color: "black" },
        },
      },
      prompt: { enabled: true },
    };
    const result = v.safeParse(PiGatherConfigSchema, full);
    expect(result.success).toBe(true);
  });

  it("rejects unknown properties (strictObject)", () => {
    const invalid = {
      version: 1,
      extraProperty: "not_allowed",
    };
    const result = v.safeParse(PiGatherConfigSchema, invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid version numbers", () => {
    const invalid = { version: 2 };
    const result = v.safeParse(PiGatherConfigSchema, invalid);
    expect(result.success).toBe(false);
  });

  it("rejects invalid hook states", () => {
    const invalid = {
      version: 1,
      hooks: {
        enabled: true,
        states: {
          ready: { state: "invalid_state" },
        },
      },
    };
    const result = v.safeParse(PiGatherConfigSchema, invalid);
    expect(result.success).toBe(false);
  });
});

describe("Config loader & utilities", () => {
  it("redacts secrets safely", () => {
    expect(redactSecret("whsec_abc123XYZ")).toBe("whsec_***");
    expect(redactSecret("some_other_secret")).toBe("***");
    expect(redactSecret("")).toBe("");
  });

  it("expands home directory properly", () => {
    const expanded = expandHome("~/test/path.env");
    expect(expanded.startsWith(os.homedir())).toBe(true);
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
  });

  it("parses .env files with quotes and comments", () => {
    const content = `
# Comment line
GSO_URL="https://api.v2.gather.town/test"
GSO_SECRET='whsec_testsecret'
PLAIN=unquoted_value
EMPTY=
  SPACED_KEY = spaced_val  
`;
    const parsed = parseEnvFile(content);
    expect(parsed.GSO_URL).toBe("https://api.v2.gather.town/test");
    expect(parsed.GSO_SECRET).toBe("whsec_testsecret");
    expect(parsed.PLAIN).toBe("unquoted_value");
    expect(parsed.SPACED_KEY).toBe("spaced_val");
  });

  it("validates gather URLs correctly", () => {
    expect(
      validateGatherUrl("https://api.v2.gather.town/api/v2/hooks/spaces/1/objects/2"),
    ).toContain("https://");

    expect(validateGatherUrl("http://localhost:8080/test")).toContain("http://localhost");
    expect(validateGatherUrl("http://127.0.0.1:8080/test")).toContain("http://127.0.0.1");

    expect(() => validateGatherUrl("http://insecure.gather.town/test")).toThrow("must use HTTPS");
    expect(() => validateGatherUrl("not_a_url")).toThrow("Invalid Gather webhook URL");
  });

  it("enforces safe file permissions on POSIX", () => {
    if (process.platform === "win32") return;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gather-test-"));
    const safeFile = path.join(tmpDir, "safe.env");
    const unsafeFile = path.join(tmpDir, "unsafe.env");

    try {
      fs.writeFileSync(safeFile, "TEST=1", { mode: 0o600 });
      expect(() => validateFilePermissions(safeFile)).not.toThrow();

      fs.writeFileSync(unsafeFile, "TEST=1", { mode: 0o644 });
      expect(() => validateFilePermissions(unsafeFile)).toThrow("unsafe permissions");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("loads config and rejects partial env overrides", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gather-test-"));
    const configFile = path.join(tmpDir, "pi-gather-hooks.json");
    const envFile = path.join(tmpDir, "gather.env");

    try {
      fs.writeFileSync(
        envFile,
        'GSO_PI_URL="https://api.v2.gather.town/test"\nGSO_PI_SECRET="whsec_file123"\n',
        { mode: 0o600 },
      );

      fs.writeFileSync(
        configFile,
        JSON.stringify({
          version: 1,
          credentialsFile: envFile,
          objects: {
            pi: { urlEnv: "GSO_PI_URL", secretEnv: "GSO_PI_SECRET" },
          },
        }),
      );

      // Normal load from file
      const loaded = loadConfig(configFile);
      expect(loaded.credentials.pi?.url).toBe("https://api.v2.gather.town/test");
      expect(loaded.credentials.pi?.secret).toBe("whsec_file123");

      // Partial override in process.env should be rejected
      process.env.GSO_PI_URL = "https://api.v2.gather.town/override";
      delete process.env.GSO_PI_SECRET;

      expect(() => loadConfig(configFile)).toThrow("Partial environment override rejected");
    } finally {
      delete process.env.GSO_PI_URL;
      delete process.env.GSO_PI_SECRET;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
