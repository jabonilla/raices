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
await check("rate-limit clientIp behind Railway", async () => {
  throw new Error(
    "UNVERIFIED: no safe low-limit endpoint or trusted clientIp diagnostic; do not infer isolation from 600/min production cap",
  );
});
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
