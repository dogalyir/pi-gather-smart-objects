import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as v from "valibot";
import { type PiGatherConfig, PiGatherConfigSchema } from "./schema.ts";

export interface ResolvedObjectCredentials {
  name: string;
  url: string;
  secret: string;
}

export interface LoadedConfigResult {
  config: PiGatherConfig;
  configPath: string | null;
  credentials: Record<string, ResolvedObjectCredentials>;
}

export function redactSecret(secret: string): string {
  if (!secret) return "";
  if (secret.startsWith("whsec_")) {
    return "whsec_***";
  }
  return "***";
}

export function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath === "~") {
    return path.join(os.homedir(), filePath.slice(1));
  }
  return filePath;
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let val = trimmed.slice(eqIndex + 1).trim();

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

export function validateFilePermissions(resolvedPath: string): void {
  if (process.platform === "win32") {
    return;
  }

  try {
    const stats = fs.statSync(resolvedPath);
    // Reject if readable/writable/executable by group or others (0o077)
    const permissions = stats.mode & 0o777;
    if ((permissions & 0o077) !== 0) {
      throw new Error(
        `Credentials file has unsafe permissions: 0${permissions.toString(
          8,
        )}. Must be restricted to owner (e.g. 0600 or 0400). Path: ${resolvedPath}`,
      );
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unsafe permissions")) {
      throw err;
    }
    // File may not exist or not accessible, handled by caller
  }
}

export function validateGatherUrl(urlStr: string): string {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid Gather webhook URL: ${urlStr}`);
  }

  const isLocalhost =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";

  if (parsed.protocol !== "https:" && !isLocalhost) {
    throw new Error(`Gather webhook URL must use HTTPS (received: ${parsed.protocol})`);
  }

  return parsed.toString();
}

export function resolveConfigPath(customPath?: string): string {
  if (customPath) {
    return path.resolve(expandHome(customPath));
  }
  if (process.env.PI_GATHER_CONFIG) {
    return path.resolve(expandHome(process.env.PI_GATHER_CONFIG));
  }
  return path.resolve(expandHome("~/.pi/agent/pi-gather-hooks.json"));
}

export function loadConfig(customConfigPath?: string): LoadedConfigResult {
  const targetPath = resolveConfigPath(customConfigPath);

  if (!fs.existsSync(targetPath)) {
    // Return disabled default config if file doesn't exist
    const emptyConfig: PiGatherConfig = {
      version: 1,
      enabled: false,
      defaultObject: "pi",
      credentialsFile: "~/.pi/agent/gather-objects.env",
      objects: {},
      hooks: { enabled: false, modes: ["tui"] },
      prompt: { enabled: false },
    };
    return {
      config: emptyConfig,
      configPath: null,
      credentials: {},
    };
  }

  let rawJson: unknown;
  try {
    const rawContent = fs.readFileSync(targetPath, "utf-8");
    rawJson = JSON.parse(rawContent);
  } catch (err) {
    throw new Error(
      `Failed to parse config file at ${targetPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const parseResult = v.safeParse(PiGatherConfigSchema, rawJson);
  if (!parseResult.success) {
    const issues = parseResult.issues
      .map((i) => `  - ${i.path?.map((p) => p.key).join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed for ${targetPath}:\n${issues}`);
  }

  const config = parseResult.output;

  // Cross-field validation: defaultObject and hooks.object
  const declaredObjects = Object.keys(config.objects ?? {});
  if (declaredObjects.length > 0 && config.defaultObject) {
    if (!declaredObjects.includes(config.defaultObject)) {
      throw new Error(
        `defaultObject "${config.defaultObject}" is not declared in config.objects (${declaredObjects.join(
          ", ",
        )})`,
      );
    }
  }

  if (config.hooks?.enabled) {
    const hookObj = config.hooks.object ?? config.defaultObject;
    if (!hookObj || !declaredObjects.includes(hookObj)) {
      throw new Error(
        `hooks.object "${hookObj}" is not declared in config.objects (${declaredObjects.join(
          ", ",
        )})`,
      );
    }
  }

  // Load credentials file if any objects declared
  let envFileVars: Record<string, string> = {};
  const credsPath = expandHome(config.credentialsFile ?? "~/.pi/agent/gather-objects.env");

  if (fs.existsSync(credsPath)) {
    validateFilePermissions(credsPath);
    try {
      const content = fs.readFileSync(credsPath, "utf-8");
      envFileVars = parseEnvFile(content);
    } catch (err) {
      if (err instanceof Error && err.message.includes("unsafe permissions")) {
        throw err;
      }
      throw new Error(`Failed to read credentials file at ${credsPath}`);
    }
  }

  // Resolve object credentials
  const credentials: Record<string, ResolvedObjectCredentials> = {};

  for (const [name, objDef] of Object.entries(config.objects ?? {})) {
    const urlFromEnv = process.env[objDef.urlEnv];
    const secretFromEnv = process.env[objDef.secretEnv];

    const urlFromFile = envFileVars[objDef.urlEnv];
    const secretFromFile = envFileVars[objDef.secretEnv];

    let url: string | undefined;
    let secret: string | undefined;

    // Check partial override: either both from process.env, or both from file
    if (urlFromEnv || secretFromEnv) {
      if (!urlFromEnv || !secretFromEnv) {
        throw new Error(
          `Partial environment override rejected for object "${name}": both ${objDef.urlEnv} and ${objDef.secretEnv} must be provided in process.env`,
        );
      }
      url = urlFromEnv;
      secret = secretFromEnv;
    } else {
      url = urlFromFile;
      secret = secretFromFile;
    }

    if (!url || !secret) {
      // Object declared but credentials missing
      continue;
    }

    const validUrl = validateGatherUrl(url);

    if (!secret.startsWith("whsec_")) {
      throw new Error(`Signing secret for object "${name}" must begin with "whsec_"`);
    }

    credentials[name] = {
      name,
      url: validUrl,
      secret,
    };
  }

  return {
    config,
    configPath: targetPath,
    credentials,
  };
}
