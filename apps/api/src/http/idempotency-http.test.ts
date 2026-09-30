import Fastify from "fastify";
import { expect, it } from "vitest";
import { toApiError } from "../errors.js";
import { installHttpIdempotency, InMemoryHttpIdempotencyStore } from "./idempotency-http.js";

function fixture() {
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  installHttpIdempotency(app, { scope: () => "synthetic-actor" });
  let calls = 0;
  app.post("/write", async (_request, reply) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return reply.header("location", "/result/1").code(201).send({ result: calls });
  });
  return { app, calls: () => calls };
}
it("requires a key and coalesces concurrent retries into one exact response", async () => {
  const { app, calls } = fixture();
  expect((await app.inject({ method: "POST", url: "/write", payload: {} })).statusCode).toBe(400);
  const results = await Promise.all(
    Array.from({ length: 12 }, () =>
      app.inject({
        method: "POST",
        url: "/write",
        headers: { "idempotency-key": "same" },
        payload: { a: 1, b: 2 },
      }),
    ),
  );
  expect(calls()).toBe(1);
  for (const r of results) {
    expect(r.statusCode).toBe(201);
    expect(r.body).toBe('{"result":1}');
    expect(r.headers.location).toBe("/result/1");
  }
  const reordered = await app.inject({
    method: "POST",
    url: "/write",
    headers: { "idempotency-key": "same" },
    payload: { b: 2, a: 1 },
  });
  expect(reordered.statusCode).toBe(201);
  const conflict = await app.inject({
    method: "POST",
    url: "/write",
    headers: { "idempotency-key": "same" },
    payload: { a: 2, b: 2 },
  });
  expect(conflict.statusCode).toBe(409);
  expect(calls()).toBe(1);
  await app.close();
});
it("isolates actors and conflicts when the same actor reuses a key for a different route", async () => {
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  installHttpIdempotency(app, { scope: (request) => String(request.headers["x-test-actor"]) });
  for (const url of ["/a", "/b"]) app.post(url, (_request, reply) => reply.send({ url }));
  const send = (url: string, actor: string) =>
    app.inject({
      method: "POST",
      url,
      headers: { "idempotency-key": "same", "x-test-actor": actor },
      payload: {},
    });
  expect((await send("/a", "one")).statusCode).toBe(200);
  expect((await send("/b", "one")).statusCode).toBe(409);
  expect((await send("/b", "two")).statusCode).toBe(200);
  await app.close();
});
it("fails closed at capacity and never expires an in-flight operation", async () => {
  let now = 0;
  const store = new InMemoryHttpIdempotencyStore({ maxEntries: 1, ttlMs: 10, now: () => now });
  expect((await store.claim("a", "hash")).kind).toBe("owner");
  now = 100;
  await expect(store.claim("b", "hash")).rejects.toThrow();
  expect((await store.claim("a", "hash")).kind).toBe("pending");
  await expect(store.claim("a", "different")).rejects.toThrow();
});

it("replays a terminal failure without rerunning the write", async () => {
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  installHttpIdempotency(app, { scope: () => "actor" });
  let calls = 0;
  app.post("/fails", () => {
    calls++;
    throw new Error("synthetic internal failure");
  });
  const input = {
    method: "POST" as const,
    url: "/fails",
    headers: { "idempotency-key": "failure" },
    payload: {},
  };
  const first = await app.inject(input),
    second = await app.inject(input);
  expect(first.statusCode).toBe(500);
  expect(second.body).toBe(first.body);
  expect(calls).toBe(1);
  await app.close();
});

it("replays empty 204 bodies and rejects credential changes under an existing key", async () => {
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  installHttpIdempotency(app, { scope: () => "actor" });
  let calls = 0;
  app.post("/empty", (_request, reply) => {
    calls++;
    return reply.code(204).send();
  });
  const send = (authorization: string) =>
    app.inject({
      method: "POST",
      url: "/empty",
      headers: { authorization, "idempotency-key": "same" },
      payload: {},
    });
  for (let i = 0; i < 2; i++) {
    const result = await send("Bearer first");
    expect(result.statusCode).toBe(204);
    expect(result.body).toBe("");
  }
  expect((await send("Bearer second")).statusCode).toBe(409);
  expect(calls).toBe(1);
  await app.close();
});
it("times out a pending replay without admitting a second write", async () => {
  const store = new InMemoryHttpIdempotencyStore();
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  installHttpIdempotency(app, { store, scope: () => "actor", waitMs: 5 });
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let calls = 0;
  app.post("/slow", async () => {
    calls++;
    entered();
    await wait;
    return { ok: true };
  });
  const input = {
    method: "POST" as const,
    url: "/slow",
    headers: { "idempotency-key": "same" },
    payload: {},
  };
  const first = app.inject(input);
  // LightMyRequest starts when the promise is observed.
  const running = first.then((response) => response);
  await started;
  expect((await app.inject(input)).statusCode).toBe(503);
  expect(calls).toBe(1);
  finish();
  expect((await running).statusCode).toBe(200);
  expect((await app.inject(input)).statusCode).toBe(200);
  expect(calls).toBe(1);
  await app.close();
});
