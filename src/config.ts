import path from "node:path";

export type AppConfig = {
  uploadToken: string;
  maxFileBytes: number;
  dataDir: string;
  publicBaseUrl: string | undefined;
  host: string;
  port: number;
};

const DEFAULT_MAX_FILE_BYTES = 90 * 1024 * 1024;

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function publicBaseUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PUBLIC_BASE_URL must use http or https");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("PUBLIC_BASE_URL must be an origin without credentials, path, query, or hash");
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const uploadToken = env.FILE_HOST_TOKEN?.trim();
  if (!uploadToken) throw new Error("FILE_HOST_TOKEN is required");

  const dataDir = path.resolve(env.DATA_DIR ?? "/data");
  if (dataDir === path.parse(dataDir).root) {
    throw new Error("DATA_DIR must not be a filesystem root");
  }

  const configuredPublicBaseUrl = publicBaseUrl(env.PUBLIC_BASE_URL);
  if (env.NODE_ENV === "production" && !configuredPublicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL is required in production");
  }

  return {
    uploadToken,
    maxFileBytes: positiveInteger(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES, "MAX_FILE_BYTES"),
    dataDir,
    publicBaseUrl: configuredPublicBaseUrl,
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env.PORT, 3000, "PORT"),
  };
}
