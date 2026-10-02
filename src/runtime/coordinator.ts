import { type LoadedConfigResult, loadConfig, redactSecret } from "../config/load.ts";
import { type GatherClient, createGatherClient } from "../gather/client.ts";
import { type ObjectMetadata, globalDiscoveryCache } from "../gather/discovery.ts";
import { ObjectLockManager } from "./ownership.ts";

export interface ManualOverride {
  status?: string;
  color?: string;
  setAt: number;
}

export class GatherCoordinator {
  private configResult: LoadedConfigResult;
  private clients = new Map<string, GatherClient>();
  private queues = new Map<string, Promise<unknown>>();
  private manualOverrides = new Map<string, ManualOverride>();
  private lockManager: ObjectLockManager;
  private isAutoPaused = false;
  private lastReportedStatus = new Map<string, { status?: string; color?: string }>();

  constructor(customConfigPath?: string, lockManager = new ObjectLockManager()) {
    this.lockManager = lockManager;
    this.configResult = loadConfig(customConfigPath);
  }

  reload(customConfigPath?: string): LoadedConfigResult {
    this.configResult = loadConfig(customConfigPath);
    this.clients.clear();
    globalDiscoveryCache.invalidate();
    return this.configResult;
  }

  getConfigResult(): LoadedConfigResult {
    return this.configResult;
  }

  getLockManager(): ObjectLockManager {
    return this.lockManager;
  }

  isAutomationPaused(): boolean {
    return this.isAutoPaused;
  }

  setAutomationPaused(paused: boolean): void {
    this.isAutoPaused = paused;
  }

  getClient(objectName?: string): GatherClient {
    const targetName = objectName ?? this.configResult.config.defaultObject ?? "pi";
    const creds = this.configResult.credentials[targetName];

    if (!creds) {
      const declared = Object.keys(this.configResult.config.objects ?? {});
      if (declared.length === 0) {
        throw new Error(
          `No Gather objects are configured. Please create ~/.pi/agent/pi-gather-hooks.json with object definitions.`,
        );
      }
      throw new Error(
        `Object "${targetName}" is not configured or missing credentials. Configured objects: ${declared.join(
          ", ",
        )}`,
      );
    }

    let client = this.clients.get(targetName);
    if (!client) {
      client = createGatherClient({
        name: targetName,
        url: creds.url,
        secret: creds.secret,
      });
      this.clients.set(targetName, client);
    }

    return client;
  }

  async getMetadata(objectName?: string, force = false): Promise<ObjectMetadata> {
    const client = this.getClient(objectName);
    return globalDiscoveryCache.getOrDiscover(client.name, client, force);
  }

  getCachedMetadata(objectName?: string): ObjectMetadata | undefined {
    const client = this.getClient(objectName);
    return globalDiscoveryCache.getCached(client.name);
  }

  enqueue<T>(objectName: string, task: () => Promise<T>): Promise<T> {
    const currentQueue = this.queues.get(objectName) ?? Promise.resolve();
    let resultPromise: Promise<T>;

    const nextQueue = currentQueue
      .catch(() => {
        // Continue queue despite previous failures
      })
      .then(async () => {
        resultPromise = task();
        return resultPromise;
      });

    this.queues.set(
      objectName,
      nextQueue.catch(() => {}),
    );

    return nextQueue as Promise<T>;
  }

  setManualOverride(objectName: string, override: { status?: string; color?: string }): void {
    const existing = this.manualOverrides.get(objectName) ?? {
      setAt: Date.now(),
    };
    if (override.status !== undefined) existing.status = override.status;
    if (override.color !== undefined) existing.color = override.color;
    existing.setAt = Date.now();
    this.manualOverrides.set(objectName, existing);
  }

  getManualOverride(objectName: string): ManualOverride | undefined {
    return this.manualOverrides.get(objectName);
  }

  clearManualOverrides(objectName?: string): void {
    if (objectName) {
      this.manualOverrides.delete(objectName);
    } else {
      this.manualOverrides.clear();
    }
  }

  getLastReportedStatus(objectName: string): { status?: string; color?: string } {
    return this.lastReportedStatus.get(objectName) ?? {};
  }

  setLastReportedStatus(objectName: string, value: { status?: string; color?: string }): void {
    const existing = this.lastReportedStatus.get(objectName) ?? {};
    this.lastReportedStatus.set(objectName, { ...existing, ...value });
  }

  dispose(): void {
    this.lockManager.releaseAll();
    this.clients.clear();
    this.manualOverrides.clear();
    this.lastReportedStatus.clear();
  }

  getDiagnostics(): Record<string, unknown> {
    const cfg = this.configResult.config;
    const creds = this.configResult.credentials;
    const objectsInfo: Record<string, unknown> = {};

    for (const [name, obj] of Object.entries(cfg.objects ?? {})) {
      const resolved = creds[name];
      const meta = globalDiscoveryCache.getCached(name);
      const lock = resolved ? this.lockManager.getLockStatus(resolved.url) : undefined;

      objectsInfo[name] = {
        hasCredentials: !!resolved,
        url: resolved?.url,
        secretConfigured: resolved ? redactSecret(resolved.secret) : false,
        urlEnv: obj.urlEnv,
        secretEnv: obj.secretEnv,
        preset: meta?.preset ?? "unknown",
        colors: meta?.colors,
        capabilities: meta?.capabilities ? Object.keys(meta.capabilities) : [],
        lockStatus: lock,
        manualOverride: this.manualOverrides.get(name),
      };
    }

    return {
      configLoaded: !!this.configResult.configPath,
      configPath: this.configResult.configPath,
      enabled: cfg.enabled,
      defaultObject: cfg.defaultObject,
      hooksConfig: cfg.hooks,
      automationPaused: this.isAutoPaused,
      objects: objectsInfo,
    };
  }
}
