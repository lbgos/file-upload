import path from "node:path";

export type AppConfig = ReturnType<typeof loadConfig>;

const DEFAULT_MAX_FILE_BYTES = 90 * 1024 * 1024;

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv) {
  const uploadToken = env.FILE_HOST_TOKEN?.trim();
  if (!uploadToken) throw new Error("FILE_HOST_TOKEN is required");

  const dataDir = path.resolve(env.DATA_DIR ?? "/data");
  if (dataDir === path.parse(dataDir).root) {
    throw new Error("DATA_DIR must not be a filesystem root");
  }

  return {
    uploadToken,
    maxFileBytes: positiveInteger(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, "MAX_FILE_BYTES"),
    dataDir,
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env.PORT, 3000, "PORT"),
  };
}
