/**
 * HTTP API:
 *   PUT    /<filename>        upload raw bytes (X-Upload-Token), responds with the public URL
 *   GET    /f/<id>/<name>     public download, supports Range and HEAD
 *   DELETE /api/files/<id>    delete an upload (X-Upload-Token)
 *   POST   /api/session       exchange X-Upload-Token for a browser session cookie
 *   DELETE /api/session       sign the browser out
 *   GET    /healthz           liveness
 *   GET    /                  upload page for the owner, project page for everyone else
 *
 * Upload and delete accept either the X-Upload-Token header (CLI, agents) or the session cookie (browser).
 */
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lookup as mimeType } from "mime-types";

import { hasValidToken, readCookie, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, sessionValue } from "./auth.js";
import type { AppConfig } from "./config.js";
import {
  deleteFile,
  findFile,
  openFileStream,
  prepareStorage,
  publishUpload,
  stageUpload,
  UploadTooLargeError,
} from "./storage.js";

const publicDirectory = fileURLToPath(new URL("../public", import.meta.url));

const staticAssets = {
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/landing.js": ["landing.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
} as const;

const PAGE_CSP =
  "default-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const FILE_CSP =
  "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; media-src blob:";

function apiError(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function headerToken(request: FastifyRequest): string | undefined {
  const supplied = request.headers["x-upload-token"];
  return Array.isArray(supplied) ? supplied[0] : supplied;
}

function sessionCookie(request: FastifyRequest, value: string, maxAge: number): string {
  const secure = request.protocol === "https" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
}

function contentDisposition(filename: string): string {
  // Stored names are ASCII slugs, so no RFC 5987 encoding is needed.
  return `inline; filename="${filename}"`;
}

function parseRange(value: string, size: number): { start: number; end: number } | undefined {
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
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || start >= size) {
    return undefined;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function createApp(config: AppConfig, options: { logger?: boolean } = {}) {
  await prepareStorage(config.dataDir);
  // trustProxy lets public URLs follow the proxy's Host and X-Forwarded-Proto, so no origin is configured.
  const app = Fastify({ logger: options.logger ?? false, trustProxy: true });

  const session = sessionValue(config.uploadToken);
  const isOwner = (request: FastifyRequest) =>
    hasValidToken(headerToken(request), config.uploadToken) ||
    hasValidToken(readCookie(request.headers.cookie, SESSION_COOKIE), session);
  const authenticate = (request: FastifyRequest, reply: FastifyReply) => {
    if (isOwner(request)) return true;
    void apiError(reply, 401, "UNAUTHORIZED", "Valid X-Upload-Token required");
    return false;
  };

  // Leave every request body unread; the upload route streams `request.raw` straight to disk.
  app.addContentTypeParser("*", (_request, _payload, done) => done(null));

  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/f/")) return;
    reply.headers({
      "content-security-policy": PAGE_CSP,
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.get("/", async (request, reply) =>
    reply
      .header("cache-control", "private, no-store")
      .header("vary", "cookie")
      .type("text/html; charset=utf-8")
      .send(await readFile(path.join(publicDirectory, isOwner(request) ? "upload.html" : "index.html"))),
  );

  // Only the header token signs in; an existing cookie cannot mint a new one.
  app.post("/api/session", async (request, reply) => {
    if (!hasValidToken(headerToken(request), config.uploadToken)) {
      return apiError(reply, 401, "UNAUTHORIZED", "Valid X-Upload-Token required");
    }
    return reply.header("set-cookie", sessionCookie(request, session, SESSION_MAX_AGE_SECONDS)).code(204).send();
  });

  app.delete("/api/session", async (request, reply) =>
    reply.header("set-cookie", sessionCookie(request, "", 0)).code(204).send(),
  );

  app.put<{ Params: { "*": string } }>("/*", async (request, reply) => {
    if (!authenticate(request, reply)) return;

    const encodedName = request.params["*"];
    if (!encodedName || encodedName.includes("/")) {
      return apiError(reply, 400, "INVALID_UPLOAD", "Upload to /<filename>");
    }
    let filename: string;
    try {
      filename = decodeURIComponent(encodedName);
    } catch {
      return apiError(reply, 400, "INVALID_UPLOAD", "Filename is not valid URL encoding");
    }

    try {
      const staged = await stageUpload(config.dataDir, filename, request.raw, config.maxFileBytes);
      await publishUpload(config.dataDir, staged);
      const url = `${request.protocol}://${request.host}/f/${staged.id}/${staged.name}`;
      return reply.code(201).type("text/plain; charset=utf-8").send(url);
    } catch (error) {
      if (error instanceof UploadTooLargeError) {
        return apiError(reply, 413, "FILE_TOO_LARGE", "File exceeds the upload limit");
      }
      if ((error as NodeJS.ErrnoException).code === "ENOSPC") {
        request.log.error({ err: error }, "upload storage is full");
        return apiError(reply, 507, "INSUFFICIENT_STORAGE", "Upload storage is full");
      }
      request.log.error({ err: error }, "upload failed");
      return apiError(reply, 500, "UPLOAD_FAILED", "Upload failed");
    }
  });

  app.delete<{ Params: { id: string } }>("/api/files/:id", async (request, reply) => {
    if (!authenticate(request, reply)) return;
    if (!(await deleteFile(config.dataDir, request.params.id))) {
      return apiError(reply, 404, "NOT_FOUND", "File not found");
    }
    return { deleted: true };
  });

  const serveFile = async (
    request: FastifyRequest<{ Params: { id: string; name: string } }>,
    reply: FastifyReply,
  ) => {
    const file = await findFile(config.dataDir, request.params.id, request.params.name);
    if (!file) return apiError(reply, 404, "NOT_FOUND", "File not found");

    reply.type(mimeType(file.name) || "application/octet-stream").headers({
      "accept-ranges": "bytes",
      // Short TTL so a deleted file drops out of the Cloudflare edge within minutes.
      "cache-control": "public, max-age=300",
      "content-disposition": contentDisposition(file.name),
      "content-security-policy": FILE_CSP,
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
    });

    const requestedRange = request.headers.range;
    const range = requestedRange ? parseRange(requestedRange, file.size) : undefined;
    if (requestedRange && !range) {
      return reply.header("content-range", `bytes */${file.size}`).code(416).send();
    }
    if (range) {
      reply.code(206).header("content-range", `bytes ${range.start}-${range.end}/${file.size}`);
    }
    reply.header("content-length", String(range ? range.end - range.start + 1 : file.size));
    return request.method === "HEAD" ? reply.send() : reply.send(openFileStream(file, range));
  };

  app.get("/f/:id/:name", { exposeHeadRoute: false }, serveFile);
  app.head("/f/:id/:name", serveFile);

  for (const [route, [filename, type]] of Object.entries(staticAssets)) {
    app.get(route, async (_request, reply) =>
      reply
        .header("cache-control", "no-cache")
        .type(type)
        .send(await readFile(path.join(publicDirectory, filename))),
    );
  }

  return app;
}
