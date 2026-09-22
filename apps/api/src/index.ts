import { buildApp } from "./app.js";

const PORT = Number(process.env["PORT"] ?? 3000);

const app = buildApp();

try {
  await app.listen({ port: PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
