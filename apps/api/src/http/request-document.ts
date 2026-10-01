import { z } from "zod";
import { SubmitSchema, DeclineSchema, RequestViewSchema } from "./requests.js";
export function requestPaths(): Record<string, unknown> {
  const content = (schema: z.ZodType) => ({
    "application/json": { schema: z.toJSONSchema(schema) },
  });
  const security = [{ bearerSession: [] }];
  const id = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
  const requestId = { ...id, name: "requestId" };
  const key = {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: { type: "string", minLength: 1, maxLength: 200 },
  };
  const errors = Object.fromEntries(
    [400, 401, 404, 409, 429, 503].map((code) => [
      String(code),
      { description: "Request refused; generic error envelope" },
    ]),
  );
  const operation = (
    schema: z.ZodType,
    response: z.ZodType,
    code: string,
    parameters: unknown[],
  ) => ({
    security,
    parameters,
    requestBody: { required: true, content: content(schema) },
    responses: { ...errors, [code]: { description: "Result", content: content(response) } },
  });
  return {
    "/relationships/{id}/requests": {
      post: operation(SubmitSchema, z.object({ id: z.uuid(), tier: z.string() }), "201", [id, key]),
      get: {
        security,
        parameters: [
          id,
          { name: "before", in: "query", schema: { type: "string" } },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 30 },
          },
        ],
        responses: {
          ...errors,
          "200": {
            description: "Requests",
            content: content(
              z.object({ items: z.array(RequestViewSchema), nextCursor: z.string().nullable() }),
            ),
          },
        },
      },
    },
    "/relationships/{id}/requests/{requestId}": {
      get: {
        security,
        parameters: [id, requestId],
        responses: {
          ...errors,
          "200": { description: "Request", content: content(RequestViewSchema) },
        },
      },
    },
    "/relationships/{id}/requests/{requestId}/approve": {
      post: operation(
        z.object({}).strict(),
        z.object({ transactionId: z.uuid(), ledgerTransactionId: z.uuid(), replayed: z.boolean() }),
        "200",
        [id, requestId, key],
      ),
    },
    "/relationships/{id}/requests/{requestId}/decline": {
      post: {
        ...operation(DeclineSchema, z.null(), "204", [id, requestId, key]),
        responses: { ...errors, "204": { description: "Declined" } },
      },
    },
  };
}
