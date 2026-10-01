import { Writable } from "node:stream";
import fc from "fast-check";
import pino from "../../apps/api/node_modules/pino/pino.js";
import { expect, it } from "vitest";
import { CENSOR, REDACT_OPTIONS, censorSensitiveKeys } from "../../apps/api/src/logging.js";
import { setSpanExporter, startSpan, type ExportedSpan } from "../../apps/api/src/telemetry.js";

it("fuzzes nesting depth and arrays through the real Pino configuration", () => {
  fc.assert(
    fc.property(fc.integer({ min: 0, max: 30 }), fc.boolean(), (depth, array) => {
      let object: Record<string, unknown> = {
        phone: "+50251234567",
        display_name: "Synthetic Secret Name",
        amount: "9007199254740993",
      };
      for (let level = 0; level < depth; level += 1) object = { nested: array ? [object] : object };
      let output = "";
      const stream = new Writable({
        write(chunk: unknown, _encoding, done) {
          output += String(chunk);
          done();
        },
      });
      pino({ redact: REDACT_OPTIONS, formatters: { log: censorSensitiveKeys } }, stream).info(
        object,
      );
      expect(output).not.toContain("+50251234567");
      expect(output).not.toContain("Synthetic Secret Name");
      expect(output).not.toContain("9007199254740993");
      expect(output).toContain(CENSOR);
    }),
    { numRuns: 100, seed: 3106 },
  );
});

it("does not leak caller-controlled span status messages", () => {
  const exported: ExportedSpan[] = [];
  setSpanExporter((span) => {
    exported.push(span);
  });
  try {
    const span = startSpan("redteam.error");
    span.setStatus(
      "error",
      "phone=+50251234567 display_name=Synthetic Secret Name amount=9007199254740993",
    );
    span.end();
    const output = JSON.stringify(exported);
    expect(output).not.toContain("+50251234567");
    expect(output).not.toContain("Synthetic Secret Name");
    expect(output).not.toContain("9007199254740993");
  } finally {
    setSpanExporter(() => {});
  }
});
