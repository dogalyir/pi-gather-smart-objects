import type { PingResult, WebhookObjectClient } from "@gathertown/webhook-object-sdk";

export interface ObjectMetadata {
  objectId: string;
  spaceId: string;
  preset: string | null;
  capabilities: Record<string, unknown>;
  colors?: string[];
  fetchedAt: number;
}

export class DiscoveryCache {
  private cache = new Map<string, ObjectMetadata>();
  private inFlight = new Map<string, Promise<ObjectMetadata>>();
  private ttlMs: number;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  async getOrDiscover(
    objectName: string,
    client: Pick<WebhookObjectClient, "ping">,
    force = false,
  ): Promise<ObjectMetadata> {
    const now = Date.now();
    const existing = this.cache.get(objectName);

    if (!force && existing && now - existing.fetchedAt < this.ttlMs) {
      return existing;
    }

    const running = this.inFlight.get(objectName);
    if (running) {
      return running;
    }

    const promise = (async () => {
      try {
        const pingResult: PingResult = await client.ping();
        const metadata: ObjectMetadata = {
          objectId: pingResult.objectId,
          spaceId: pingResult.spaceId,
          preset: pingResult.preset,
          capabilities: pingResult.capabilities,
          colors: pingResult.colors,
          fetchedAt: Date.now(),
        };
        this.cache.set(objectName, metadata);
        return metadata;
      } finally {
        this.inFlight.delete(objectName);
      }
    })();

    this.inFlight.set(objectName, promise);
    return promise;
  }

  getCached(objectName: string): ObjectMetadata | undefined {
    const existing = this.cache.get(objectName);
    if (!existing) return undefined;
    if (Date.now() - existing.fetchedAt > this.ttlMs) {
      this.cache.delete(objectName);
      return undefined;
    }
    return existing;
  }

  invalidate(objectName?: string): void {
    if (objectName) {
      this.cache.delete(objectName);
    } else {
      this.cache.clear();
    }
  }
}

export const globalDiscoveryCache = new DiscoveryCache();
