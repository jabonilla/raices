import type { FastifyBaseLogger } from "fastify";

import type { WebhookEvent } from "@raices/channels";

/**
 * The no-op webhook handler (K2.28). The skeleton's job is the receiving
 * pipeline — verify, validate, normalize, dedupe — not the business logic.
 * Phase 3 will route inbound messages to the real use cases; until then this
 * handler acknowledges receipt and does nothing else.
 *
 * PII discipline: only provider message ids and event types are logged.
 * Bodies and phone numbers never reach the logs (the K2.5 redaction would
 * censor them anyway; not emitting them is the stronger guarantee).
 */
export function handleWebhookEvent(event: WebhookEvent, log: FastifyBaseLogger): void {
  switch (event.type) {
    case "inbound":
      log.debug(
        { providerMessageId: event.message.providerMessageId, channel: event.message.channel },
        "webhook inbound accepted (no-op handler)",
      );
      return;
    case "delivery":
      log.debug(
        { providerMessageId: event.update.providerMessageId, state: event.update.state },
        "webhook delivery update accepted (no-op handler)",
      );
      return;
    case "unknown":
      // Unrecognized payloads are logged and ignored — never an error.
      log.info("webhook payload not recognized; ignored");
      return;
  }
}
