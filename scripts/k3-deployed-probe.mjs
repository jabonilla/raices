#!/usr/bin/env node
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";

// fetch and AbortSignal are Node 22 globals with no node: module export.
/* global fetch, AbortSignal */
const base = process.env.BASE_URL;
if (!base) throw new Error("BASE_URL is required");
const origin = new URL(base);
if (origin.protocol !== "https:") throw new Error("BASE_URL must be HTTPS");
let requests = 0;
async function probe(path, options = {}) {
  if (++requests > 10) throw new Error("Request budget exceeded");
  const response = await fetch(new URL(path, origin), {
    ...options,
    signal: AbortSignal.timeout(5000),
    redirect: "manual",
  });
  const body = await response.text();
  assert.ok(body.length < 16000, "Oversized response");
  return { response, body };
}
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log("PASS", name);
  } catch (error) {
    failures.push(name + ": " + error.message);
    console.error("FAIL", name, error.message);
  }
}
await check("health", async () => {
  const { response } = await probe("/health");
  assert.equal(response.status, 200);
});
await check("404 envelope and no leaks", async () => {
  const { response, body } = await probe("/__k3_20_missing__");
  assert.equal(response.status, 404);
  const parsed = JSON.parse(body);
  assert.equal(typeof parsed.error, "object", "missing error envelope");
  assert.notEqual(parsed.error, null, "missing error envelope");
  for (const field of ["code", "message", "requestId"])
    assert.equal(typeof parsed.error[field], "string", `error.${field} must be a string`);
  assert.equal(parsed.error.code, "not_found");
  assert.doesNotMatch(
    body,
    /stack trace|DATABASE_URL|postgres(?:ql)?:\/\/|password=|SELECT \* FROM/i,
  );
});
await check("bad webhook signature rejected", async () => {
  const { response } = await probe("/webhooks/channel", {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-signature": "invalid-k3-probe" },
    body: "{}",
  });
  assert.equal(response.status, 401);
});
// The clientIp check depends on the staging-only diagnostic from #139, which
// only exists when DIAGNOSTIC_IP_SALT is set. That secret is gated on the
// Railway containment decision, so until it lands the route is absent (404).
// Absent => explicit, logged SKIP (the property is still UNVERIFIED, and the
// log says so). Present => it must prove the property or the probe FAILS.
const skipped = [];
await check("rate-limit clientIp behind Railway", async () => {
  const path = "/__diagnostics/client-ip";
  const plain = await probe(path);
  if (plain.response.status === 404) {
    skipped.push(
      "rate-limit clientIp behind Railway: UNVERIFIED (diagnostic route absent; DIAGNOSTIC_IP_SALT not set)",
    );
    return;
  }
  assert.equal(plain.response.status, 200, "diagnostic present but not 200");
  const first = JSON.parse(plain.body).clientIpHash;
  assert.match(String(first), /^[0-9a-f]{64}$/, "clientIpHash must be a sha256 hex digest");
  // A client-supplied X-Forwarded-For must not change who the API thinks we
  // are: with one trusted proxy hop, the spoofed leftmost entry is ignored.
  const spoofed = await probe(path, { headers: { "x-forwarded-for": "203.0.113.7" } });
  assert.equal(spoofed.response.status, 200, "diagnostic (spoofed XFF) not 200");
  assert.equal(
    JSON.parse(spoofed.body).clientIpHash,
    first,
    "spoofed X-Forwarded-For changed the client identity: rate limits can be bypassed",
  );
});
for (const line of skipped) console.log("SKIP", line);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
