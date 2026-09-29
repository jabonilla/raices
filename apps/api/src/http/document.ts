import { z } from "zod";
import { RequestCodeSchema, VerifyCodeSchema } from "../identity/service.js";
import { buildOpenApiDocument } from "../openapi.js";
import {
  EmptyWriteSchema,
  IdempotencyKeySchema,
  InviteResponseSchema,
  InviteSchema,
  RelationshipParamsSchema,
  RelationshipResponseSchema,
} from "./relationships.js";

const IssuedSessionSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  userId: z.uuid(),
  expiresAt: z.iso.datetime(),
});
const ChallengeResponseSchema = z.object({ challengeId: z.uuid() });
const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), requestId: z.string() }),
});
function json(schema: z.ZodType) {
  return { "application/json": { schema: z.toJSONSchema(schema) } };
}

/** Host owner calls this instead of the current baseline generator.
 * Parameters, request bodies and responses are generated from runtime Zod
 * schemas. Operation metadata supplies only routing and protocol semantics.
 */
export function buildHttpOpenApiDocument() {
  const baseline = buildOpenApiDocument();
  const paths: Record<string, unknown> = { ...baseline.paths };
  for (const route of [
    {
      path: "/auth/otp/request",
      body: RequestCodeSchema,
      response: ChallengeResponseSchema,
      code: "202",
    },
    {
      path: "/auth/otp/verify",
      body: VerifyCodeSchema,
      response: IssuedSessionSchema,
      code: "200",
    },
  ]) {
    paths[route.path] = {
      post: {
        requestBody: { required: true, content: json(route.body) },
        responses: {
          [route.code]: { description: "Accepted", content: json(route.response) },
          "400": { description: "Invalid input", content: json(ErrorSchema) },
          "401": { description: "Denied", content: json(ErrorSchema) },
          "429": { description: "Rate limited", content: json(ErrorSchema) },
        },
      },
    };
  }
  const security = [{ bearerSession: [] }];
  const errorResponses = {
    "400": { description: "Invalid input", content: json(ErrorSchema) },
    "401": { description: "Authentication required", content: json(ErrorSchema) },
    "404": { description: "Resource unavailable", content: json(ErrorSchema) },
    "409": { description: "Conflict", content: json(ErrorSchema) },
    "429": { description: "Rate limited", content: json(ErrorSchema) },
    "503": { description: "Retry or reconciliation required", content: json(ErrorSchema) },
  };
  paths["/auth/session/revoke"] = {
    post: { security, responses: { "204": { description: "Revoked" }, ...errorResponses } },
  };
  paths["/relationships"] = {
    get: {
      security,
      responses: {
        "200": {
          description: "Member relationships",
          content: json(z.array(RelationshipResponseSchema)),
        },
        ...errorResponses,
      },
    },
  };
  const paramsJson = z.toJSONSchema(RelationshipParamsSchema);
  const idSchema = "properties" in paramsJson ? paramsJson.properties["id"] : undefined;
  const parameters = [{ name: "id", in: "path", required: true, schema: idSchema }];
  const key = {
    name: "idempotency-key",
    in: "header",
    required: true,
    schema: z.toJSONSchema(IdempotencyKeySchema),
  };
  paths["/relationships/{id}"] = {
    get: {
      security,
      parameters,
      responses: {
        "200": { description: "Member relationship", content: json(RelationshipResponseSchema) },
        ...errorResponses,
      },
    },
  };
  paths["/relationships/invite"] = {
    post: {
      security,
      parameters: [key],
      requestBody: { required: true, content: json(InviteSchema) },
      responses: {
        "201": { description: "Invitation", content: json(InviteResponseSchema) },
        ...errorResponses,
      },
    },
  };
  for (const action of ["accept", "pause", "terminate"]) {
    paths[`/relationships/{id}/${action}`] = {
      post: {
        security,
        parameters: [...parameters, key],
        requestBody: { required: false, content: json(EmptyWriteSchema) },
        responses: {
          "200": {
            description: "Updated member relationship",
            content: json(RelationshipResponseSchema),
          },
          ...errorResponses,
        },
      },
    };
  }
  return {
    ...baseline,
    paths,
    components: {
      ...baseline.components,
      securitySchemes: { bearerSession: { type: "http", scheme: "bearer" } },
    },
  };
}
