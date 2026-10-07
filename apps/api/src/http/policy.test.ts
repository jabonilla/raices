import Fastify from "fastify";
import { expect, it } from "vitest";
import { UnauthorizedError, toApiError } from "../errors.js";
import { installAuthorization } from "./policy.js";

it("refuses an undeclared route, including routes registered by a child plugin", async () => {
  const app = Fastify();
  installAuthorization(app, {
    identity: {
      authenticate: () => Promise.reject(new UnauthorizedError()),
    },
  });
  expect(() => app.get("/forgotten", () => Promise.resolve({ leaked: true }))).toThrow(/policy/);
  await app.close();
  const child = Fastify();
  installAuthorization(child, {
    identity: {
      authenticate: () => Promise.reject(new UnauthorizedError()),
    },
  });
  await expect(
    child
      .register(async (scope) => {
        await Promise.resolve();
        scope.get("/forgotten", () => Promise.resolve("secret"));
      })
      .ready(),
  ).rejects.toThrow(/policy/);
  await child.close();
});
it("enforces sender policy before the handler for GET and implicit HEAD", async () => {
  const app = Fastify();
  const router = installAuthorization(app, {
    identity: {
      authenticate: () => Promise.reject(new UnauthorizedError()),
    },
  });
  let calls = 0;
  app.setErrorHandler((error, request, reply) => {
    const mapped = toApiError(error, request.id);
    void reply.code(mapped.statusCode).send(mapped.body);
  });
  router.route({
    method: "GET",
    url: "/private",
    policy: { kind: "sender" },
    handler: () => {
      calls++;
      return Promise.resolve("secret");
    },
  });
  router.route({
    method: "GET",
    url: "/public",
    policy: { kind: "public" },
    handler: () => Promise.resolve("ok"),
  });
  for (const method of ["GET", "HEAD"] as const)
    expect((await app.inject({ method, url: "/private" })).statusCode).toBe(401);
  expect(calls).toBe(0);
  expect((await app.inject("/public")).body).toBe("ok");
  expect(router.inventory()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ method: "HEAD", url: "/private", policy: "sender" }),
    ]),
  );
  await app.close();
});
