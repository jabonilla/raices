import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { z } from "zod";

import type { ChannelAdapter, WebhookEvent } from "@raices/channels";

import { BadRequestError, UnauthorizedError } from "../errors.js";
import type { InboundDeduplicator } from "./dedupe.js";
import { handleWebhookEvent } from "./handler.js";
import type { WebhookSignatureVerifier } from "./signature.js";

/**
 * Route-level payload shape (K2.28). The route is provider-agnostic: it only
 * requires a JSON object. Deep validation is the adapter's job —
 * `normalizeWebhook` never throws and maps unrecognized payloads to
 * `{ type: "unknown" }` for the handler to log and ignore. Anything that is
 * not a JSON object at all (array, string, number, null) is malformed and
 * gets a 400 through the K2.10 envelope.
 */
const WebhookPayloadSchema = z.record(z.string(), z.unknown());

/** Header carrying the caller's signature (the fake's convention). */
export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

export interface WebhookRouteDeps {
  readonly adapter: ChannelAdapter;
  readonly verifier: WebhookSignatureVerifier;
  readonly deduplicator: InboundDeduplicator;
  /**
   * Event handoff. Defaults to the no-op `handleWebhookEvent`; tests inject
   * a spy to assert at-most-once processing.
   */
  readonly handleEvent?: ((event: WebhookEvent, log: FastifyBaseLogger) => Promise<void> | void) | undefined;
}

export interface WebhookAcceptedBody {
  readonly ok: true;
  /** True when the webhook was accepted but ignored as a duplicate. */
  readonly deduped: boolean;
}

/**
 * POST /webhooks/channel — the receiving half of the channel seam.
 *
 * Pipeline, in order:
 * 1. Signature verification → 401 through the envelope when it fails.
 * 2. Zod payload-shape validation → 400 through the envelope when malformed.
 * 3. `adapter.normalizeWebhook` — never throws (issue #41 is a test now).
 * 4. At-least-once dedupe by provider message id — duplicates are accepted
 *    and ignored: 200, never 500, never processed twice.
 * 5. Handoff to the (no-op) handler.
 *
 * Malformed input can never crash the process: the body parser caps size at
 * 256 KiB, Zod rejects non-objects, and normalization is total.
 */
export function registerWebhookRoutes(app: FastifyInstance, deps: WebhookRouteDeps): void {
  app.post("/webhooks/channel", async (request, reply): Promise<WebhookAcceptedBody> => {
    // 1. Signature. Fastify has already parsed the body, so re-serialize is
    // not the raw bytes — the skeleton documents this gap honestly: the
    // fake signs the parsed-then-stringified form, and the real verifier in
    // Phase 3 will hook the raw body via a content parser. For the skeleton
    // the interface (rawBody in, boolean out) is the deliverable.
    const rawBody = Buffer.from(JSON.stringify(request.body ?? null));
    const header = request.headers[WEBHOOK_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!deps.verifier.verify({ rawBody, signature })) {
      throw new UnauthorizedError("Invalid webhook signature.");
    }

    // 2. Payload shape.
    const parsed = WebhookPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError("Webhook payload must be a JSON object.");
    }

    // 3. Normalize. Total by contract — this is where issue #41 stops being
    // a convention and becomes a test (packages/channels/test).
    const event = deps.adapter.normalizeWebhook(parsed.data);

    // 4 + 5. Dedupe inbound messages, then hand off.
    if (event.type === "inbound") {
      const duplicate = deps.deduplicator.checkAndMark(event.message.providerMessageId);
      if (duplicate) {
        request.log.debug(
          { providerMessageId: event.message.providerMessageId },
          "duplicate webhook ignored",
        );
        return { ok: true, deduped: true };
      }
    }

    const handleEvent = deps.handleEvent ?? handleWebhookEvent;
    await handleEvent(event, request.log);
    const statusCode = event.type === "inbound" ? 202 : 200;
    reply.status(statusCode);
    return { ok: true, deduped: false };
  });
}
