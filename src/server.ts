import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup as mimeType } from "mime-types";

import { hasValidToken } from "./auth.js";
import type { AppConfig } from "./config.js";
import {
  deleteFile,
  discardUpload,
  findFile,
  openFileStream,
  prepareStorage,
  publishUpload,
  stageUpload,
  type StagedUpload,
  UploadTooLargeError,
} from "./storage.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(moduleDirectory, "../public");

const unauthorized = { error: { code: "UNAUTHORIZED", message: "Valid bearer token required" } };

class InvalidUploadError extends Error {}

function authenticate(request: FastifyRequest, reply: FastifyReply, token: string): boolean {
  const supplied = request.headers["x-upload-token"];
  if (hasValidToken(Array.isArray(supplied) ? supplied[0] : supplied, token)) return true;
  void reply.code(401).send(unauthorized);
  return false;
}

function baseUrl(request: FastifyRequest, configured: string | undefined): string {
  if (configured) return configured;
  return `${request.protocol}://${request.hostname}`;
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_");
  const encoded = encodeURIComponent(filename).replace(/['()]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function setFileHeaders(reply: FastifyReply, name: string): void {
  reply.headers({
    "accept-ranges": "bytes",
    "cache-control": "public, max-age=31536000, immutable",
    "content-disposition": contentDisposition(name),
    "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:",
    "cross-origin-resource-policy": "cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(value);
  if (!match || size === 0) return undefined;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return undefined;

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd === "" ? size - 1 : Number(rawEnd);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function staticAsset(reply: FastifyReply, filename: string, type: string): Promise<void> {
  const body = await readFile(path.join(publicDirectory, filename));
  reply
    .header("cache-control", filename === "index.html" ? "no-cache" : "public, max-age=3600")
    .type(type)
    .send(body);
}

export async function createApp(
  config: AppConfig,
  options: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  await prepareStorage(config.dataDir);
  const app = Fastify({
    logger: options.logger ?? false,
    trustProxy: true,
    bodyLimit: config.maxFileBytes + 1024 * 1024,
  });

  app.addContentTypeParser("*", (_request, payload, done) => done(null, payload));

  app.addHook("onSend", async (request, reply) => {
    if (!request.url.startsWith("/f/")) {
      reply.headers({
        "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      });
    }
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.put<{ Params: { "*": string } }>("/*", async (request, reply) => {
    if (!authenticate(request, reply, config.uploadToken)) return;

    let staged: StagedUpload | undefined;
    try {
      const encodedFilename = request.params["*"];
      if (!encodedFilename || encodedFilename.includes("/")) {
        throw new InvalidUploadError("A filename path is required");
      }
      let filename: string;
      try {
        filename = decodeURIComponent(encodedFilename);
      } catch {
        throw new InvalidUploadError("Filename is not valid URL encoding");
      }
      const stream = request.body;
      if (!stream || typeof (stream as NodeJS.ReadableStream).pipe !== "function") {
        throw new InvalidUploadError("A file body is required");
      }
      staged = await stageUpload(
        config.dataDir,
        filename,
        stream as NodeJS.ReadableStream as import("node:stream").Readable,
        config.maxFileBytes,
      );
      await publishUpload(config.dataDir, staged);
      const url = `${baseUrl(request, config.publicBaseUrl)}/f/${staged.id}/${encodeURIComponent(staged.name)}`;
      return reply.code(201).type("text/plain; charset=utf-8").send(url);
    } catch (error) {
      await discardUpload(staged);
      if (error instanceof UploadTooLargeError) {
        return reply.code(413).send({ error: { code: "FILE_TOO_LARGE", message: "File exceeds the upload limit" } });
      }
      if (error instanceof InvalidUploadError) {
        return reply.code(400).send({ error: { code: "INVALID_UPLOAD", message: error.message } });
      }
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
        request.log.error({ err: error }, "upload storage is full");
        return reply.code(507).send({ error: { code: "INSUFFICIENT_STORAGE", message: "Upload storage is full" } });
      }
      request.log.error({ err: error }, "upload failed");
      return reply.code(500).send({ error: { code: "UPLOAD_FAILED", message: "Upload failed" } });
    }
  });

  app.delete<{ Params: { id: string } }>("/api/files/:id", async (request, reply) => {
    if (!authenticate(request, reply, config.uploadToken)) return;
    if (!(await deleteFile(config.dataDir, request.params.id))) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "File not found" } });
    }
    return { deleted: true };
  });

  const serveFile = async (
    request: FastifyRequest<{ Params: { id: string; name: string } }>,
    reply: FastifyReply,
    headOnly: boolean,
  ) => {
    const file = await findFile(config.dataDir, request.params.id, request.params.name);
    if (!file) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "File not found" } });

    setFileHeaders(reply, file.name);
    reply.type(mimeType(file.name) || "application/octet-stream");
    const requestedRange = request.headers.range;
    const range = parseRange(requestedRange, file.size);
    if (requestedRange && !range) {
      return reply.header("content-range", `bytes */${file.size}`).code(416).send();
    }
    if (range) {
      reply
        .code(206)
        .header("content-range", `bytes ${range.start}-${range.end}/${file.size}`)
        .header("content-length", String(range.end - range.start + 1));
      return headOnly ? reply.send() : reply.send(openFileStream(file, range.start, range.end));
    }
    reply.header("content-length", String(file.size));
    return headOnly ? reply.send() : reply.send(openFileStream(file));
  };

  app.get<{ Params: { id: string; name: string } }>(
    "/f/:id/:name",
    { exposeHeadRoute: false },
    (request, reply) => serveFile(request, reply, false),
  );
  app.head<{ Params: { id: string; name: string } }>("/f/:id/:name", (request, reply) =>
    serveFile(request, reply, true),
  );

  app.get("/", (_request, reply) => staticAsset(reply, "index.html", "text/html; charset=utf-8"));
  app.get("/styles.css", (_request, reply) => staticAsset(reply, "styles.css", "text/css; charset=utf-8"));
  app.get("/app.js", (_request, reply) => staticAsset(reply, "app.js", "text/javascript; charset=utf-8"));
  app.get("/favicon.svg", (_request, reply) => staticAsset(reply, "favicon.svg", "image/svg+xml"));

  return app;
}
