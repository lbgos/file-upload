import { loadConfig } from "./config.js";
import { createApp } from "./server.js";

const config = loadConfig(process.env);
const app = await createApp(config, { logger: true });

const stop = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
