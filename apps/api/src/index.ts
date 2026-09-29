import { buildApp } from "./app.js";
import { readEnv } from "./env.js";

const { port } = readEnv();

const app = buildApp();

try {
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
