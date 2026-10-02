import { describe, expect, it } from "bun:test";
import { Webhook } from "standardwebhooks";
import {
  checkPayloadSize,
  createGatherClient,
  sanitizeErrorMessage,
} from "../src/gather/client.ts";
import { DiscoveryCache } from "../src/gather/discovery.ts";

// Synthetic test secret (valid base64 after whsec_ prefix)
const TEST_SECRET = "whsec_C3RhbmRhcmR3ZWJob29rc19zZWNyZXRfdGVzdF8xMjM=";
const TEST_URL = "http://localhost:9999/api/v2/hooks/test";

describe("Gather Protocol & Client", () => {
  it("enforces 4096 bytes payload limit locally", () => {
    expect(() => checkPayloadSize("status.set", { state: "working" })).not.toThrow();

    const hugeText = "a".repeat(5000);
    expect(() => checkPayloadSize("activity.add", { id: "1", text: hugeText })).toThrow(
      "exceeds Gather 4096 bytes limit",
    );
  });

  it("sanitizes secret from error messages", () => {
    const rawError = `Failed to connect with secret ${TEST_SECRET} at endpoint`;
    const sanitized = sanitizeErrorMessage(rawError, TEST_SECRET);
    expect(sanitized).not.toContain(TEST_SECRET);
    expect(sanitized).toContain("whsec_***");
  });

  it("signs requests adhering to Standard Webhooks v1", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: string | undefined;

    const mockFetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      capturedHeaders = new Headers(init?.headers);
      capturedBody = init?.body as string;

      return new Response(JSON.stringify({ status: "dispatched" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = createGatherClient({
      url: TEST_URL,
      secret: TEST_SECRET,
      name: "test-object",
      fetch: mockFetch,
    });

    const result = await client.send("status.set", { state: "working" });
    expect(result.status).toBe("dispatched");

    expect(capturedHeaders).toBeDefined();
    expect(capturedBody).toBeDefined();

    // Verify User-Agent
    expect(capturedHeaders?.get("User-Agent")).toBe("pi-gather-smart-objects/0.1.0");

    // Verify Standard Webhooks headers
    const webhookId = capturedHeaders?.get("webhook-id");
    const webhookTimestamp = capturedHeaders?.get("webhook-timestamp");
    const webhookSignature = capturedHeaders?.get("webhook-signature");

    expect(webhookId).toBeTruthy();
    expect(webhookTimestamp).toBeTruthy();
    expect(webhookSignature).toBeTruthy();

    // Verify signature using the reference standardwebhooks library
    const wh = new Webhook(TEST_SECRET);
    const verified = wh.verify(capturedBody!, {
      "webhook-id": webhookId!,
      "webhook-timestamp": webhookTimestamp!,
      "webhook-signature": webhookSignature!,
    });
    expect(verified).toBeDefined();
  });

  it("handles discovery cache and single-flight deduplication", async () => {
    let pingCount = 0;

    const mockClient = {
      async ping() {
        pingCount++;
        await new Promise((r) => setTimeout(r, 50));
        return {
          status: "pong" as const,
          objectId: "obj-123",
          spaceId: "space-456",
          preset: "status" as const,
          capabilities: { status: { state: "off" } },
          colors: ["red", "green", "blue"],
        };
      },
    };

    const cache = new DiscoveryCache(1000);

    // Call getOrDiscover concurrently
    const [res1, res2] = await Promise.all([
      cache.getOrDiscover("obj", mockClient),
      cache.getOrDiscover("obj", mockClient),
    ]);

    expect(pingCount).toBe(1); // Single-flight in action
    expect(res1.objectId).toBe("obj-123");
    expect(res2.objectId).toBe("obj-123");

    // Second call uses cache
    const res3 = await cache.getOrDiscover("obj", mockClient);
    expect(pingCount).toBe(1);
    expect(res3.preset).toBe("status");

    // Invalidation causes re-fetch
    cache.invalidate("obj");
    await cache.getOrDiscover("obj", mockClient);
    expect(pingCount).toBe(2);
  });
});
