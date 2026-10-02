import {
  createWebhookObjectClient,
  type PingResult,
  type SendResult,
  WebhookObjectError,
  type WebhookObjectClient,
} from "@gathertown/webhook-object-sdk";
import type { WebhookEventType } from "@gathertown/webhook-object-types";
import { redactSecret } from "../config/load.ts";

export interface GatherClientOptions {
  url: string;
  secret: string;
  name?: string;
  fetch?: typeof fetch;
  defaultTimeoutMs?: number;
}

export interface GatherClient {
  name: string;
  url: string;
  send(
    type: WebhookEventType,
    data?: unknown,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<SendResult>;
  ping(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<PingResult>;
  rawClient: WebhookObjectClient;
}

const DEFAULT_USER_AGENT = "pi-gather-smart-objects/0.1.0";
const MAX_PAYLOAD_BYTES = 4096;

export function sanitizeErrorMessage(message: string, secret: string): string {
  if (!secret) return message;
  const redacted = redactSecret(secret);
  return message.replaceAll(secret, redacted);
}

export function combineSignals(
  timeoutMs: number,
  userSignal?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error(`Operation timed out after ${timeoutMs}ms`));
  }, timeoutMs);

  const onUserAbort = () => {
    controller.abort(userSignal?.reason ?? new Error("Operation aborted"));
  };

  if (userSignal) {
    if (userSignal.aborted) {
      clearTimeout(timer);
      controller.abort(userSignal.reason);
    } else {
      userSignal.addEventListener("abort", onUserAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      if (userSignal) {
        userSignal.removeEventListener("abort", onUserAbort);
      }
    },
  };
}

export function checkPayloadSize(type: string, data?: unknown): void {
  const envelope = JSON.stringify({
    type,
    timestamp: new Date().toISOString(),
    data: data ?? {},
  });
  const bytes = new TextEncoder().encode(envelope).length;
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload size is ${bytes} bytes, which exceeds Gather 4096 bytes limit`);
  }
}

export function createGatherClient(options: GatherClientOptions): GatherClient {
  const { url, secret, name = "default", defaultTimeoutMs = 10000 } = options;

  const baseFetch = options.fetch ?? globalThis.fetch;
  const wrappedFetch = ((
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", DEFAULT_USER_AGENT);
    }
    return baseFetch(input, { ...init, headers });
  }) as unknown as typeof fetch;

  const rawClient = createWebhookObjectClient({
    url,
    secret,
    fetch: wrappedFetch,
  });

  const wrapCall = async <T>(
    fn: (client: WebhookObjectClient) => Promise<T>,
    timeoutMs: number,
    userSignal?: AbortSignal,
  ): Promise<T> => {
    const { signal, cleanup } = combineSignals(timeoutMs, userSignal);
    try {
      if (signal.aborted) {
        throw signal.reason;
      }
      return await fn(rawClient);
    } catch (err: unknown) {
      if (err instanceof WebhookObjectError) {
        let msg = `Gather error (${err.code}): ${err.message}`;
        if (err.code === "not_found") {
          msg +=
            " [Hint: check clock skew (+/- 5 min), object URL, secret, and body serialization]";
        } else if (err.code === "capability_not_declared") {
          msg +=
            " [Hint: object preset does not declare this capability. Run webhook.ping to inspect]";
        }
        throw new Error(sanitizeErrorMessage(msg, secret));
      }
      const rawMsg = err instanceof Error ? err.message : String(err);
      throw new Error(sanitizeErrorMessage(rawMsg, secret));
    } finally {
      cleanup();
    }
  };

  return {
    name,
    url,
    rawClient,
    async send(type, data, callOptions) {
      checkPayloadSize(type, data);
      const timeoutMs = callOptions?.timeoutMs ?? defaultTimeoutMs;
      return wrapCall(
        (c) =>
          data !== undefined
            ? (c.send as (t: string, d: unknown) => Promise<SendResult>)(type, data)
            : (c.send as (t: string) => Promise<SendResult>)(type),
        timeoutMs,
        callOptions?.signal,
      );
    },
    async ping(callOptions) {
      const timeoutMs = callOptions?.timeoutMs ?? defaultTimeoutMs;
      return wrapCall((c) => c.ping(), timeoutMs, callOptions?.signal);
    },
  };
}
